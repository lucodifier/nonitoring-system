import * as http from 'http';
import * as crypto from 'crypto';
import { AppDataSource } from '../data-source';
import { Vm } from '../entities/Vm';
import { DiskSnapshot } from '../entities/DiskSnapshot';
import { vmConfig } from '../config/vm-config';
import { log } from '../logger';

/**
 * Servidor HTTP do heartbeat (modelo push).
 *
 * Usa o módulo `http` nativo de propósito: o worker não tem framework web hoje, e
 * dois endpoints não justificam trazer Express para dentro da imagem.
 */

interface DiskPayload {
  mount: string;
  totalGb: number;
  usedGb: number;
}

interface HeartbeatPayload {
  hostname: string;
  disks?: DiskPayload[];
}

const json = (
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
};

/**
 * Compara o token em tempo constante.
 *
 * `timingSafeEqual` exige buffers do mesmo tamanho, então o comprimento é
 * verificado antes -- e essa comparação de tamanho vaza só o tamanho, não o valor.
 */
const tokenMatches = (provided: string): boolean => {
  const expected = vmConfig.heartbeat.token;
  if (!expected || !provided) return false;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};

const extractToken = (req: http.IncomingMessage): string => {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const header = req.headers['x-monitor-token'];
  if (typeof header === 'string') return header.trim();
  return '';
};

const tooLarge = () => Object.assign(new Error('corpo acima do limite'), { statusCode: 413 });

/**
 * Lê o corpo com teto de bytes. Sem o teto, um agente com bug (ou um POST
 * malicioso) poderia manter o worker alocando memória indefinidamente.
 *
 * O Content-Length é conferido ANTES de ler qualquer byte: os dois agentes mandam
 * esse header, então o caso normal responde 413 sem alocar nada. O guarda no
 * stream continua valendo como rede de segurança para corpo em chunked.
 *
 * Ao estourar, a leitura é pausada em vez de `req.destroy()`: destruir o socket
 * fecha a conexão antes de a resposta sair, e o agente veria "connection reset"
 * no lugar de um 413 que ele consegue logar.
 */
const readBody = (req: http.IncomingMessage, maxBytes: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(tooLarge());
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;

    req.on('data', (chunk: Buffer) => {
      if (rejected) return;

      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        req.pause();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });

const finiteNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Valida o corpo do heartbeat.
 *
 * Discos inválidos são descartados individualmente em vez de rejeitar o POST
 * inteiro: um mount exótico com número estranho não pode fazer a VM perder o
 * heartbeat e disparar um alerta de "sem heartbeat" que é falso.
 */
function parsePayload(raw: string): { payload: HeartbeatPayload; disks: DiskPayload[] } | string {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'corpo não é JSON válido';
  }

  if (!parsed || typeof parsed !== 'object') return 'corpo deve ser um objeto JSON';

  const hostname = typeof parsed.hostname === 'string' ? parsed.hostname.trim() : '';
  if (!hostname) return 'campo "hostname" é obrigatório';
  if (hostname.length > 255) return 'campo "hostname" excede 255 caracteres';

  const disks: DiskPayload[] = [];
  if (Array.isArray(parsed.disks)) {
    for (const entry of parsed.disks) {
      if (!entry || typeof entry !== 'object') continue;

      const mount = typeof entry.mount === 'string' ? entry.mount.trim() : '';
      const totalGb = finiteNumber(entry.totalGb);
      const usedGb = finiteNumber(entry.usedGb);

      if (!mount || mount.length > 255) continue;
      if (totalGb === null || usedGb === null) continue;
      // usedGb > totalGb e um estado impossivel: entraria na serie e a regressao
      // projetaria enchimento a partir de um ponto que nunca existiu.
      if (totalGb <= 0 || usedGb < 0 || usedGb > totalGb) continue;

      disks.push({ mount, totalGb, usedGb });
    }
  }

  return { payload: { hostname }, disks };
}

async function handleHeartbeat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!tokenMatches(extractToken(req))) {
    json(res, 401, { error: 'token inválido ou ausente' });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req, vmConfig.heartbeat.maxBodyBytes);
  } catch (err: any) {
    // Connection: close porque o resto do corpo não vai ser lido -- sem isso o
    // keep-alive deixaria bytes órfãos atravessando para a próxima requisição.
    json(res, err.statusCode === 413 ? 413 : 400, { error: err.message }, { Connection: 'close' });
    return;
  }

  const parsed = parsePayload(raw);
  if (typeof parsed === 'string') {
    json(res, 400, { error: parsed });
    return;
  }

  const { payload, disks } = parsed;

  if (!AppDataSource.isInitialized) {
    json(res, 503, { error: 'banco de dados indisponível' });
    return;
  }

  const vmRepo = AppDataSource.getRepository(Vm);
  const vm = await vmRepo.findOne({ where: { hostname: payload.hostname } });

  // 404 em vez de cadastrar sozinho: uma VM que ninguém registrou não deveria
  // entrar no monitoramento por um POST, e o 404 avisa quem instalou o agente
  // que falta o cadastro.
  if (!vm) {
    log.warn(`[Heartbeat] hostname não cadastrado em monitoring.vms: ${payload.hostname}`);
    json(res, 404, { error: `hostname "${payload.hostname}" não cadastrado em monitoring.vms` });
    return;
  }

  const now = new Date();
  await vmRepo.update({ id: vm.id }, { lastHeartbeatAt: now });

  if (disks.length > 0) {
    const snapshotRepo = AppDataSource.getRepository(DiskSnapshot);
    await snapshotRepo.save(
      disks.map((d) => {
        const snapshot = new DiskSnapshot();
        snapshot.vmId = vm.id;
        snapshot.mount = d.mount;
        snapshot.totalGb = d.totalGb;
        snapshot.usedGb = d.usedGb;
        snapshot.collectedAt = now;
        return snapshot;
      }),
    );
  }

  log.info(`[Heartbeat] ${payload.hostname}: ok (${disks.length} disco(s))`);
  json(res, 200, { ok: true, vmId: vm.id, disksAccepted: disks.length, receivedAt: now.toISOString() });
}

export function createHeartbeatServer(): http.Server {
  return http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];

    const handle = async () => {
      if (req.method === 'GET' && url === '/monitor/health') {
        json(res, 200, { ok: true, dbConnected: AppDataSource.isInitialized });
        return;
      }

      if (req.method === 'POST' && url === '/monitor/heartbeat') {
        await handleHeartbeat(req, res);
        return;
      }

      json(res, 404, { error: 'rota não encontrada' });
    };

    // Erro no handler vira 500, não exceção não tratada: o worker roda o ciclo de
    // serviços no mesmo processo e não pode cair por causa de um POST malformado.
    handle().catch((err: any) => {
      log.error(`[Heartbeat] Erro ao tratar ${req.method} ${url}: ${err.message}`);
      if (!res.headersSent) json(res, 500, { error: 'erro interno' });
    });
  });
}

/**
 * Sobe o servidor, se houver token configurado.
 *
 * Sem MONITOR_HEARTBEAT_TOKEN o servidor não sobe: um endpoint de escrita aberto
 * seria pior que a ausência do recurso.
 */
export async function startHeartbeatServer(): Promise<http.Server | null> {
  if (!vmConfig.enabled) {
    log.debug('[Heartbeat] VM_MONITORING_ENABLED != true — servidor não iniciado.');
    return null;
  }

  if (!vmConfig.heartbeat.token) {
    log.error(
      '[Heartbeat] MONITOR_HEARTBEAT_TOKEN não configurado — endpoint NÃO iniciado (recusa subir sem autenticação).',
    );
    return null;
  }

  const server = createHeartbeatServer();
  const { port, bind } = vmConfig.heartbeat;

  // Espera o 'listening' e rejeita no 'error'.
  //
  // Antes isto so logava: com a porta ocupada (EADDRINUSE) ou sem permissao
  // (EACCES) o worker seguiria rodando o ciclo de VMs sem receber heartbeat
  // nenhum -- e em 15 minutos dispararia 'no_heartbeat' para TODAS as VMs.
  // Um alerta falso em massa e pior que nao subir.
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, bind);
  });

  // Erro depois de no ar (ex: queda do socket) nao pode derrubar o processo,
  // que tambem roda o ciclo de servicos.
  server.on('error', (err: Error) => {
    log.error(`[Heartbeat] Erro no servidor HTTP: ${err.message}`);
  });

  console.warn(`[Heartbeat] Escutando em http://${bind}:${port}/monitor/heartbeat`);
  return server;
}
