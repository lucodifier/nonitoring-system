import { api } from '@/lib/api';

export type VmHealth = 'healthy' | 'warning' | 'down' | 'unknown';

/** Estado reportado pelo hypervisor ou pela sonda. */
export type VmStatus = 'running' | 'stopped' | 'paused' | 'unreachable' | 'unknown';

export interface VmDisk {
  mount: string;
  totalGb: number;
  usedGb: number;
  usedPercent: number;
  collectedAt: string;
}

/** Disco no detalhe: o mesmo do resumo, mais a projeção calculada pela API. */
export interface VmDiskForecast {
  mount: string;
  totalGb: number;
  usedGb: number;
  usedPercent: number;
  growthGbPerDay: number | null;
  daysUntilFull: number | null;
  sampleCount: number;
  severity: 'critical' | 'warning' | null;
  reason: string;
  /** Já formatado pela API ("~32 horas"), para tela e chat dizerem a mesma coisa. */
  horizon: string | null;
}

export interface VmAlert {
  id: string;
  vmId: string;
  type: 'down' | 'paused' | 'no_heartbeat' | 'disk_warning' | 'disk_critical' | string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  scope: string | null;
  currentValue: number | null;
  notifiedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Vm {
  id: string;
  hostname: string;
  name: string | null;
  ip: string | null;
  providerId: string | null;
  enabled: boolean;
  lastHeartbeatAt: string | null;
  consecutiveProbeFailures: number;
  status: VmStatus | null;
  statusSource: string | null;
  statusCheckedAt: string | null;
  health: VmHealth;
  heartbeatAgeMinutes: number | null;
  heartbeatStale: boolean;
  disks: VmDisk[];
  worstDisk: VmDisk | null;
  openAlerts: VmAlert[];
}

export interface VmDetails extends Omit<Vm, 'disks' | 'worstDisk' | 'openAlerts'> {
  disks: VmDiskForecast[];
  alerts: VmAlert[];
  thresholds: {
    warningPercent: number;
    criticalPercent: number;
    forecastWarningDays: number;
    forecastCriticalHours: number;
    minSamplesForTrend: number;
  };
}

export interface VmStatusHistoryEntry {
  id: string;
  status: VmStatus;
  source: string | null;
  checkedAt: string;
}

export interface VmDiskSeries {
  mount: string;
  samples: Array<{
    collectedAt: string;
    usedGb: number;
    totalGb: number;
    usedPercent: number;
  }>;
}

export interface VmSummary {
  total: number;
  enabled: number;
  healthy: number;
  warning: number;
  down: number;
  unknown: number;
  openAlerts: number;
}

export const vmsService = {
  getAll: async (enabled?: boolean): Promise<Vm[]> => {
    const params = enabled === undefined ? '' : `?enabled=${enabled}`;
    const response = await api.get(`/vms${params}`);
    return response.data;
  },

  getSummary: async (): Promise<VmSummary> => {
    const response = await api.get('/vms/summary');
    return response.data;
  },

  getById: async (id: string): Promise<VmDetails> => {
    const response = await api.get(`/vms/${id}`);
    return response.data;
  },

  getHistory: async (id: string, hours = 24): Promise<VmStatusHistoryEntry[]> => {
    const response = await api.get(`/vms/${id}/history?hours=${hours}`);
    return response.data;
  },

  getDiskHistory: async (id: string, days = 7): Promise<VmDiskSeries[]> => {
    const response = await api.get(`/vms/${id}/disks?days=${days}`);
    return response.data;
  },

  getAlerts: async (id: string, onlyOpen = false): Promise<VmAlert[]> => {
    const response = await api.get(`/vms/${id}/alerts?onlyOpen=${onlyOpen}`);
    return response.data;
  },

  setEnabled: async (id: string, enabled: boolean): Promise<Vm> => {
    const response = await api.patch(`/vms/${id}/enabled`, { enabled });
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Formatação compartilhada entre a lista e o detalhe
// ---------------------------------------------------------------------------

export const healthColors: Record<VmHealth, string> = {
  healthy: 'text-green-500 bg-green-500/10 border-green-500/20',
  warning: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  down: 'text-destructive bg-destructive/10 border-destructive/20',
  unknown: 'text-muted-foreground bg-muted/10 border-muted/20',
};

export const healthLabels: Record<VmHealth, string> = {
  healthy: 'OK',
  warning: 'ATENÇÃO',
  down: 'CRÍTICO',
  unknown: 'SEM DADOS',
};

export const statusLabels: Record<string, string> = {
  running: 'Ligada',
  stopped: 'Parada',
  paused: 'Pausada',
  unreachable: 'Inacessível',
  unknown: 'Indeterminado',
};

/** Faixa de cor do disco — os mesmos 80/90 que o worker usa para alertar. */
export const diskColor = (percent: number, warning = 80, critical = 90): string => {
  if (percent > critical) return 'text-destructive';
  if (percent > warning) return 'text-amber-500';
  return 'text-green-500';
};

export const formatAge = (minutes: number | null): string => {
  if (minutes === null) return 'nunca';
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${Math.floor(minutes)}min atrás`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
};

export const formatRelative = (date: string | null): string => {
  if (!date) return 'N/A';
  const diffMinutes = (Date.now() - new Date(date).getTime()) / 60000;
  return formatAge(diffMinutes);
};

export const formatGb = (gb: number): string =>
  gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${gb.toFixed(1)} GB`;
