import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

const list = (name: string, fallback: number[]): number[] => {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const parsed = raw
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
  return parsed.length ? parsed : fallback;
};

export type VmProviderKind =
  | 'auto'
  | 'proxmox-ssh'
  | 'libvirt-ssh'
  | 'proxmox-api'
  | 'govc-ssh'
  | 'none';

const providerKind = (): VmProviderKind => {
  const raw = (process.env.VM_PROVIDER || 'auto').trim().toLowerCase();
  const allowed: VmProviderKind[] = [
    'auto',
    'proxmox-ssh',
    'libvirt-ssh',
    'proxmox-api',
    'govc-ssh',
    'none',
  ];
  return (allowed as string[]).includes(raw) ? (raw as VmProviderKind) : 'auto';
};

/**
 * Toda a configuração do monitoramento de VMs, com defaults que preservam o
 * comportamento atual: com VM_MONITORING_ENABLED ausente nada roda, então subir
 * esta versão sem mexer no Infisical não muda nada em produção.
 */
export const vmConfig = {
  enabled: bool('VM_MONITORING_ENABLED', false),
  cronExpression: process.env.VM_CRON_EXPRESSION || '*/2 * * * *',
  provider: providerKind(),

  proxmoxApi: {
    url: (process.env.PROXMOX_API_URL || '').replace(/\/+$/, ''),
    tokenId: process.env.PROXMOX_API_TOKEN_ID || '',
    tokenSecret: process.env.PROXMOX_API_TOKEN_SECRET || '',
    // Default seguro (igual ao do Node). Certificado autoassinado no parque
    // interno e' caso real, mas tem que ser uma excecao declarada: sem validar,
    // um intermediario captura o token da API e devolve estado de VM falso.
    rejectUnauthorized: bool('PROXMOX_API_REJECT_UNAUTHORIZED', true),
  },

  probe: {
    ports: list('VM_PROBE_PORTS', [22, 3389]),
    timeoutMs: num('VM_PROBE_TIMEOUT_MS', 3000),
    pingViaSsh: bool('VM_PING_VIA_SSH', true),
    failuresToAlert: Math.max(1, Math.floor(num('VM_UNREACHABLE_FAILURES', 3))),
  },

  heartbeat: {
    port: Math.floor(num('HEARTBEAT_PORT', 5080)),
    bind: process.env.HEARTBEAT_BIND || '0.0.0.0',
    token: process.env.MONITOR_HEARTBEAT_TOKEN || '',
    maxAgeMinutes: num('HEARTBEAT_MAX_AGE_MINUTES', 15),
    maxBodyBytes: Math.floor(num('HEARTBEAT_MAX_BODY_BYTES', 64 * 1024)),
  },

  disk: {
    warningPercent: num('DISK_WARNING_PERCENT', 80),
    criticalPercent: num('DISK_CRITICAL_PERCENT', 90),
    trendWindowDays: num('DISK_TREND_WINDOW_DAYS', 7),
    forecastWarningDays: num('DISK_FORECAST_WARNING_DAYS', 7),
    forecastCriticalHours: num('DISK_FORECAST_CRITICAL_HOURS', 48),
    minSamplesForTrend: Math.max(2, Math.floor(num('DISK_MIN_SAMPLES_FOR_TREND', 3))),
  },

  alerts: {
    cooldownMinutes: num('VM_ALERT_COOLDOWN_MINUTES', 30),
  },
};

export type VmConfig = typeof vmConfig;
