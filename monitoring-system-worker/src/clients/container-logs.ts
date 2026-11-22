import * as dotenv from 'dotenv';
import { SSHConfig, execSSHCommandRaw } from './docker-ssh';
import { log } from '../logger';

dotenv.config({ quiet: true });

/**
 * Coleta contagem de erros/warnings lendo o stdout dos containers via `docker logs` por SSH.
 *
 * Existe porque o Loki é uma dependência externa que já ficou indisponível sem ninguém
 * perceber (host de log fora do ar => errorCount sempre 0 => alerta de erro nunca dispara,
 * mesmo com o serviço cuspindo exceção em loop). Este coletor não depende de Loki,
 * Promtail/Alloy nem de nenhum host extra: usa a mesma conexão SSH que o worker já
 * abre para consultar `docker ps`/`docker stats`.
 *
 * Usado quando LOKI_ENABLED != 'true'. Se o Loki voltar, ele tem precedência.
 */

export interface LogCounts {
  errorCount: number;
  warningCount: number;
  /** Última linha que casou com o padrão de erro, truncada. Vai no corpo do alerta. */
  lastError: string | null;
}

const EMPTY: LogCounts = { errorCount: 0, warningCount: 0, lastError: null };

const CONTAINER_LOGS_ENABLED = (process.env.CONTAINER_LOGS_ENABLED || 'true') === 'true';

/** Teto de linhas lidas por container por ciclo, para não trafegar log gigante pelo SSH. */
const MAX_LINES = parseInt(process.env.CONTAINER_LOGS_MAX_LINES || '5000', 10);

/**
 * Teto da janela de leitura, em minutos.
 *
 * MONITORING_INTERVAL_MINUTES é a janela de consulta ao Loki e em prod está em 240,
 * enquanto o cron roda a cada minuto. No Loki isso é uma agregação barata; aqui seria
 * despejar 4h de log de cada container a cada minuto pelo SSH. Então a janela do Loki
 * não vale como janela de `docker logs`: limitamos aqui, independente dela.
 */
const MAX_WINDOW_MINUTES = parseInt(process.env.CONTAINER_LOGS_WINDOW_MINUTES || '15', 10);

/** Tamanho máximo da amostra de erro enviada no alerta. */
const LAST_ERROR_MAX_CHARS = parseInt(process.env.CONTAINER_LOGS_LAST_ERROR_CHARS || '400', 10);

/**
 * Casa tanto log estruturado quanto texto solto:
 *  - pino/JSON: "level":50 (error) e "level":60 (fatal)
 *  - .NET/snowflake-sdk e afins: "level":"ERROR"
 *  - Serilog console: "[09:43:20 ERR]" / "[09:43:20 FTL]"
 *  - texto puro: error, erro, exception, fatal, critical, failed
 *
 * As palavras soltas exigem fronteira de palavra (\b): sem isso, uma métrica como
 * "ack_failed_files=0" numa linha INF casava com "failed" e virava erro/alerta falso.
 */
const BASE_ERROR_PATTERN =
  '"level":(50|60)|"level":"(ERROR|FATAL|CRITICAL)"|(ERR|FTL)\\]|\\b(error|erro|exception|fatal|critical|failed)\\b';

const BASE_WARNING_PATTERN = '"level":40|"level":"WARN(ING)?"|WRN\\]|\\b(warn|warning)\\b';

/**
 * Linha que o próprio app marca com nível Serilog não-erro (ex.: "[09:43:20 INF] ...").
 * É removida ANTES do grep de erro: se o app declarou a linha como INFO/DEBUG, o
 * conteúdo dela nunca deve contar como erro, mesmo contendo "failed"/"error" no texto.
 * JSON estruturado ("level":50 etc.) não carrega essa tag, então não é afetado.
 * Só vale no cabeçalho (início da linha): com grep -i, um erro JSON cuja mensagem cita
 * "[12:00:00 inf]" não pode ser descartado.
 */
const SERILOG_NON_ERROR_TAG = '^\\[[^]]+ (INF|DBG|VRB|WRN)\\]';
const SERILOG_NON_WARNING_TAG = '^\\[[^]]+ (INF|DBG|VRB)\\]';

/**
 * Mesma ideia para os outros formatos que declaram o nível:
 *  - pino JSON: "level":10/20/30 (trace/debug/info) e 40 (warn). Ex.: o log de sucesso
 *    {"level":30,...,"failed":0,"msg":"syncImages: concluído — 2 atualizado(s), 0 erro(s)"}
 *    casava com "failed"/"erro" e virava "errors in logs (2 errors)" na paralogy-api.
 *    Só vale o nível do próprio registro: o pino grava "level" como primeiro campo, então a
 *    regra é ancorada no início da linha. Um "level" aninhado (ex.: {"level":50,...,
 *    "context":{"level":30}}) não descarta o erro.
 *  - pino-pretty: "[2026-11-10 05:05:16.946] INFO: ..." / "DEBUG:" / "TRACE:" / "WARN:",
 *    com ou sem o PID/host depois do nível ("INFO (42):", "INFO (42 on host):"), com ou sem
 *    a cor ANSI do colorize em volta do nível ("ESC[32mINFOESC[39m:"; o "." casa o ESC), com
 *    ou sem o caller ("INFO (42) <src/app.js:10>:"), com o horário antes, depois do nível
 *    (levelFirst: "INFO [17:35:28.992] (42): ...") ou sem horário (ignore: 'time':
 *    "INFO (42): ...").
 *  - pino JSON com o nível em texto ({"level":"info"}, via formatters.level).
 * As exclusões rodam com grep -i: "info"/"INFO" e "inf"/"INF" valem igual.
 */
const PINO_PRETTY_PID = '( \\([^)]*\\))?';
const PINO_ANSI_COLOR = '(.\\[[0-9;]*m)?';
const PINO_JSON_LEVEL = (numbers: string, names: string): string =>
  `^\\{"level":((${numbers})[,}]|"(${names})")`;
const PINO_PRETTY_CALLER = '( <[^>]*>)?';
/**
 * Cabeçalho do pino-pretty: horário opcional antes do nível (padrão) ou depois dele
 * (levelFirst), PID/host e caller opcionais, terminando em ":".
 */
const PINO_PRETTY_LEVEL = (names: string): string => {
  const level = `${PINO_ANSI_COLOR}(${names})${PINO_ANSI_COLOR}`;
  return `^(\\[[^]]+\\] )?${level}( \\[[^]]+\\])?${PINO_PRETTY_PID}${PINO_PRETTY_CALLER}:`;
};
const PINO_NON_ERROR_LEVEL = [
  PINO_JSON_LEVEL('10|20|30|40', 'trace|debug|info|warn|warning'),
  PINO_PRETTY_LEVEL('TRACE|DEBUG|INFO|WARN'),
].join('|');
const PINO_NON_WARNING_LEVEL = [
  PINO_JSON_LEVEL('10|20|30', 'trace|debug|info'),
  PINO_PRETTY_LEVEL('TRACE|DEBUG|INFO'),
].join('|');

/**
 * Linha de continuação: corpo de um registro de várias linhas, como o objeto de erro do axios
 * que o pino-pretty despeja indentado ou um stack trace. Era contada uma vez por linha: 1 falha
 * de rede no ranking-worker virou "16 errors". O registro em si é contado pela linha de
 * cabeçalho ("[...] ERROR: ...", "[... ERR] ...").
 *
 * Indentação pequena não basta para ser continuação: há registros próprios que começam com
 * 2 espaços (ex.: "  ✗ Error saving status to database" deste worker) e precisam contar.
 * Continuação é tab, 4+ espaços (corpo do pino-pretty) ou frame de stack trace ("   at ...").
 */
const CONTINUATION_LINE = '^(\t|[[:space:]]{4}|[[:space:]]+at[[:space:]])';

/**
 * O cabeçalho de erro/aviso do pino-pretty conta mesmo colorido. Com a cor ANSI, o "m" antes
 * de ERROR impede o \bERROR\b; como o corpo do registro (continuação) não conta mais, um
 * "ESC[31mERRORESC[39m (42): connection refused" seguido do stack trace contaria zero.
 */
const ERROR_PATTERN =
  process.env.LOG_ERROR_PATTERN || [BASE_ERROR_PATTERN, PINO_PRETTY_LEVEL('ERROR|FATAL')].join('|');

const WARNING_PATTERN =
  process.env.LOG_WARNING_PATTERN || [BASE_WARNING_PATTERN, PINO_PRETTY_LEVEL('WARN')].join('|');

const NON_ERROR_LINE = [SERILOG_NON_ERROR_TAG, PINO_NON_ERROR_LEVEL, CONTINUATION_LINE].join('|');
const NON_WARNING_LINE = [SERILOG_NON_WARNING_TAG, PINO_NON_WARNING_LEVEL, CONTINUATION_LINE].join('|');

/** Nome de container vem do banco; só interpolamos no shell se casar com este formato. */
const SAFE_CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** Envolve em aspas simples para o shell remoto, escapando aspas simples internas. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Monta um único comando que lê o log uma vez e devolve três linhas:
 *   1) contagem de erros
 *   2) contagem de warnings
 *   3) última linha de erro (truncada)
 *
 * `grep -c` sai com código 1 quando não acha nada, por isso o `true` no fim:
 * sem ele o execSSHCommandRaw rejeitaria um ciclo perfeitamente saudável.
 */
const buildCommand = (containerName: string, minutes: number): string => {
  const errPattern = shellQuote(ERROR_PATTERN);
  const warnPattern = shellQuote(WARNING_PATTERN);
  const notError = shellQuote(NON_ERROR_LINE);
  const notWarning = shellQuote(NON_WARNING_LINE);

  return [
    `L=$(docker logs --since ${minutes}m --tail ${MAX_LINES} ${containerName} 2>&1)`,
    `printf '%s' "$L" | grep -viE ${notError} | grep -ciE ${errPattern}`,
    `printf '%s' "$L" | grep -viE ${notWarning} | grep -ciE ${warnPattern}`,
    `printf '%s' "$L" | grep -viE ${notError} | grep -iE ${errPattern} | tail -n 1 | cut -c1-${LAST_ERROR_MAX_CHARS}`,
    `true`,
  ].join('; ');
};

const parseCount = (value: string | undefined): number => {
  const parsed = parseInt((value || '').trim(), 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
};

/**
 * Lê o stdout do container e devolve as contagens do intervalo.
 * Nunca lança: qualquer falha vira contagem zero + log, igual ao cliente do Loki.
 */
export const queryContainerLogCounts = async (
  sshConfig: SSHConfig | undefined,
  containerName: string | null,
  minutes: number = 15
): Promise<LogCounts> => {
  if (!CONTAINER_LOGS_ENABLED) return EMPTY;

  if (!sshConfig) {
    log.warn('  ⚠️  Container logs: SSH não configurado (DOCKER_SSH_HOST/USERNAME) - contagem = 0');
    return EMPTY;
  }

  if (!containerName) return EMPTY;

  if (!SAFE_CONTAINER_NAME.test(containerName)) {
    log.warn(`  ⚠️  Container logs: nome inválido, ignorado por segurança: ${containerName}`);
    return EMPTY;
  }

  const window = Math.max(1, Math.min(minutes, MAX_WINDOW_MINUTES));

  try {
    const output = await execSSHCommandRaw(sshConfig, buildCommand(containerName, window));
    const lines = output.split('\n');

    const errorCount = parseCount(lines[0]);
    const warningCount = parseCount(lines[1]);
    const lastError = lines.slice(2).join('\n').trim() || null;

    log.info(
      `  ✓ Container logs (${containerName}, janela ${window}m): ${errorCount} erros, ${warningCount} warnings`
    );

    return { errorCount, warningCount, lastError: errorCount > 0 ? lastError : null };
  } catch (error: any) {
    log.error(`  ✗ Falha ao ler docker logs de ${containerName}: ${error.message}`);
    return EMPTY;
  }
};
