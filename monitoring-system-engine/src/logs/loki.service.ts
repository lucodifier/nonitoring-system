import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface LogEntry {
  timestamp: string;
  message: string;
  level: string;
  service: string;
  raw?: string; // Linha original completa do log (JSON completo)
}

@Injectable()
export class LokiService {
  private readonly logger = new Logger(LokiService.name);
  private readonly lokiUrl =
    process.env.LOKI_URL || process.env.LOKI_BASE_URL || 'http://10.10.10.224:3100';
  /**
   * Label de ambiente usada nas consultas ao Loki.
   * Mapeia NODE_ENV / APP_ENV para os valores esperados em Loki: dev, stg, prod.
   */
  private readonly lokiEnvLabel: string;

  /**
   * Nomes dos labels usados na query LogQL. Devem ser iguais aos do Grafana/Loki.
   * Ex.: Promtail/Docker costumam usar container_name em vez de container.
   */
  private readonly labelContainer: string;
  private readonly labelEnv: string;

  constructor() {
    this.logger.log(`Loki URL configured: ${this.lokiUrl}`);
    const rawEnv =
      process.env.MONITORING_ENV ||
      'prod';

    const normalized = rawEnv.toLowerCase();
    if (normalized === 'production' || normalized === 'prod') {
      this.lokiEnvLabel = 'prod';
    } else if (normalized === 'staging' || normalized === 'stage' || normalized === 'stg') {
      this.lokiEnvLabel = 'stg';
    } else if (normalized === 'development' || normalized === 'dev') {
      this.lokiEnvLabel = 'dev';
    } else {
      // fallback: usa o valor bruto caso não caia nos padrões conhecidos
      this.lokiEnvLabel = rawEnv;
    }

    // Labels LogQL: conferir no Grafana (Label browser) os nomes exatos
    this.labelContainer = process.env.LOKI_LABEL_CONTAINER || 'container';
    this.labelEnv = process.env.LOKI_LABEL_ENV || 'env';

    this.logger.log(`Loki env label configured: ${this.lokiEnvLabel} (from ${rawEnv})`);
    this.logger.log(`Loki query labels: ${this.labelEnv}=..., ${this.labelContainer}=...`);
  }

  /**
   * Normaliza valor de ambiente para o label Loki: prod, stg ou dev.
   */
  private normalizeEnvLabel(env: string): string {
    const normalized = env.toLowerCase().trim();
    if (normalized === 'production' || normalized === 'prod') return 'prod';
    if (normalized === 'staging' || normalized === 'stage' || normalized === 'stg') return 'stg';
    if (normalized === 'development' || normalized === 'dev') return 'dev';
    return normalized;
  }

  async getLogs(
    serviceNameOrLabel: string,
    limit: number = 100,
    start?: string,
    end?: string,
    levelFilter?: string,
    envOverride?: string,
  ): Promise<LogEntry[]> {
    try {
      // Query LogQL para buscar logs do serviço
      // Se já for uma query completa (começa com {), usa diretamente
      // Senão, monta {env="<env>", container="<serviceNameOrLabel>"}.
      // env: parâmetro da requisição (envOverride) tem prioridade sobre o ambiente do engine.
      let query: string;
      const trimmed = serviceNameOrLabel.trim();
      if (trimmed.startsWith('{')) {
        query = trimmed;
      } else {
        const envLabel = envOverride != null && envOverride !== ''
          ? this.normalizeEnvLabel(envOverride)
          : this.lokiEnvLabel;
        query = `{${this.labelEnv}="${envLabel}", ${this.labelContainer}="${trimmed}"}`;
      }
      
      // Adicionar filtro de level se fornecido (ex: "error")
      // No LogQL, precisamos filtrar de forma mais abrangente
      if (levelFilter) {
        if (levelFilter === 'error') {
          // Buscar logs de erro - busca em toda a linha:
          // 1. "[error]" (formato comum de log formatado)
          // 2. "level": 50-99 (JSON com level numérico)
          // 3. "level":"error" (JSON com level string)
          // 4. "❌" (emoji de erro)
          // Regex case-insensitive busca qualquer um desses padrões
          query = `${query} |~ "(?i)\\[error\\]|\\\"level\\\":\\s*(5[0-9]|[6-9][0-9]|\\\"error\\\")|❌"`;
        } else if (levelFilter === 'warn') {
          query = `${query} |~ "(?i)\\[warn\\]|\\\"level\\\":\\s*(4[0-9]|\\\"warn\\\")|⚠️"`;
        } else {
          query = `${query} |~ "(?i)\\"level\\":\\s*\\"${levelFilter}\\""`;
        }
      }
      
      // Se não fornecido, usa últimos 1 hora para ter mais logs
      const now = Date.now();
      const endTime = end ? new Date(end).getTime() * 1000000 : now * 1000000; // nanosegundos
      const startTime = start ? new Date(start).getTime() * 1000000 : (now - (60 * 60 * 1000)) * 1000000; // 1 hora atrás

      const params: any = {
        query,
        limit,
        direction: 'backward', // Mais recentes primeiro
        start: startTime.toString(),
        end: endTime.toString(),
      };

      const startDate = new Date(startTime / 1000000).toISOString();
      const endDate = new Date(endTime / 1000000).toISOString();
      this.logger.log(`Querying Loki at ${this.lokiUrl}: ${query}, start: ${startDate}, end: ${endDate}`);
      
      const response = await axios.get(`${this.lokiUrl}/loki/api/v1/query_range`, { 
        params,
        timeout: 30000,
      });
      
      this.logger.log(`Loki response from ${this.lokiUrl}: status ${response.status}`);
      
      this.logger.log(`Loki response status: ${response.status}, streams: ${response.data?.data?.result?.length || 0}`);
      
      const streams = response.data?.data?.result || [];
      this.logger.log(`Found ${streams.length} stream(s) in Loki response`);
      
      const logs: LogEntry[] = [];

      for (const stream of streams) {
        if (!stream.values || stream.values.length === 0) {
          this.logger.debug(`Stream ${JSON.stringify(stream.stream)} has no values`);
          continue;
        }
        this.logger.debug(`Processing stream with ${stream.values.length} log entries`);
        const labels = stream.stream;
        const values = stream.values; // [timestamp_ns, log_line]

        for (const [tsNs, line] of values) {
          // Converter timestamp nanosegundos para milisegundos
          const tsMs = parseInt(tsNs) / 1000000;
          
          // Tentar fazer parse se for JSON, senão usar a linha crua
          let message = line;
          let level = 'info';

          try {
            const parsed = JSON.parse(line);
            message = parsed.msg || parsed.message || line;
            level = parsed.level || 'info';
            // Normalizar level numérico do Pino/Bunyan
            if (typeof level === 'number') {
              if (level >= 50) level = 'error';
              else if (level >= 40) level = 'warn';
              else level = 'info';
            } else if (typeof level === 'string') {
              level = level.toLowerCase();
            }
          } catch (e) {
            // Não é JSON, tenta inferir level por string
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes('[error]') || lowerLine.includes('❌') || 
                (lowerLine.includes('erro') && !lowerLine.includes('debug'))) {
              level = 'error';
            } else if (lowerLine.includes('[warn]') || lowerLine.includes('⚠️') || lowerLine.includes('warn')) {
              level = 'warn';
            } else {
              level = 'info';
            }
            message = line;
          }
          
          // Garantir que logs com indicadores de erro sejam marcados como error
          const messageLower = message.toLowerCase();
          if (level !== 'error' && (messageLower.includes('[error]') || messageLower.includes('❌') || 
              (messageLower.includes('erro') && !messageLower.includes('debug')))) {
            level = 'error';
          }

          logs.push({
            timestamp: new Date(tsMs).toISOString(),
            message,
            level,
            service: labels[this.labelContainer] || labels.container || labels.job || serviceNameOrLabel,
            raw: line, // Guardar linha original completa
          });
        }
      }

      // Ordenar por data decrescente (caso venha de múltiplos streams)
      const sortedLogs = logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      this.logger.log(`Returning ${sortedLogs.length} log entries`);
      return sortedLogs;

    } catch (error: any) {
      this.logger.error(`Error querying Loki for ${serviceNameOrLabel}: ${error.message}`);
      if (error.response) {
        this.logger.error(`Loki response status: ${error.response.status}`, error.response.data);
      }
      return [];
    }
  }
}
