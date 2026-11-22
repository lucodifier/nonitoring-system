import { api } from '@/lib/api';

export interface LogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  service: string;
  raw?: string; // Linha original completa do log (JSON completo)
}

export const logsService = {
  getLogs: async (serviceName: string, limit: number = 100, start?: string, end?: string, levelFilter?: string) => {
    const response = await api.get<LogEntry[]>(`/logs/${serviceName}`, {
      params: { limit, start, end, level: levelFilter },
    });
    return response.data;
  },
};

export interface ServiceErrorEntry {
  id: string;
  serviceId: string;
  errorMessage: string;
  errorType?: string;
  errorLevel?: string;
  stackTrace?: string;
  context?: Record<string, unknown>;
  isResolved: boolean;
  occurredAt: string;
}

/**
 * Erros gravados pelo worker em monitoring.service_errors.
 *
 * Diferente de getLogs (que depende do Loki), esta fonte não depende de nenhum
 * coletor de logs externo: o worker le o stdout do container e grava aqui.
 */
export const serviceErrorsService = {
  getByService: async (serviceId: string, limit: number = 20) => {
    const response = await api.get<ServiceErrorEntry[]>(`/services/${serviceId}/errors`, {
      params: { limit },
    });
    return response.data;
  },
};

/**
 * URL do Dozzle para acompanhar o stdout do container ao vivo.
 *
 * A rota do Dozzle e /container/<id do docker> -- o NOME do container nao resolve.
 * Esse id muda a cada redeploy, entao nao pode vir de services.container_id (que
 * guarda o nome): vem de currentStatus.metadata.containerRuntimeId, recoletado
 * pelo worker a cada ciclo.
 *
 * Sem o id (serviço ainda não coletado, ou parado), cai na raiz do Dozzle em vez
 * de montar um link quebrado.
 */
export const dozzleUrlFor = (containerRuntimeId?: string) => {
  const base = import.meta.env.VITE_DOZZLE_URL || 'http://localhost:8082';
  return containerRuntimeId ? `${base}/container/${containerRuntimeId}` : base;
};

/** Extrai o id de runtime do container a partir do status atual do serviço. */
export const runtimeIdOf = (service?: { currentStatus?: { metadata?: any } }): string | undefined =>
  service?.currentStatus?.metadata?.containerRuntimeId || undefined;
