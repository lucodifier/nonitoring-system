import { vmConfig } from '../config/vm-config';

export interface DiskSample {
  usedGb: number;
  totalGb: number;
  collectedAt: Date;
}

export interface DiskForecast {
  mount: string;
  usedGb: number;
  totalGb: number;
  usedPercent: number;
  /** Crescimento em GB/dia pela regressão. Null quando não há amostra suficiente. */
  growthGbPerDay: number | null;
  /** Dias até 100%. Null quando não dá para projetar (sem tendência de alta). */
  daysUntilFull: number | null;
  sampleCount: number;
}

/**
 * Regressão linear por mínimos quadrados de used_gb ao longo do tempo.
 *
 * Tempo em dias desde a primeira amostra (e não timestamp absoluto): mantém os
 * números pequenos e o slope já sai na unidade que a mensagem usa, GB/dia.
 */
function linearSlopeGbPerDay(samples: DiskSample[]): number | null {
  if (samples.length < 2) return null;

  const t0 = samples[0].collectedAt.getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const s of samples) {
    const x = (s.collectedAt.getTime() - t0) / MS_PER_DAY;
    const y = s.usedGb;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const n = samples.length;
  const denominator = n * sumXX - sumX * sumX;

  // Denominador zero = todas as amostras no mesmo instante: não há reta a ajustar.
  if (denominator === 0) return null;

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Projeta quando o disco enche, a partir das amostras da janela de tendência.
 *
 * `samples` precisa vir em ordem cronológica crescente.
 *
 * Retorna daysUntilFull = null quando o uso está estável ou caindo (slope <= 0):
 * projetar "enche em 40 mil dias" não ajuda ninguém, e o alerta amarelo por
 * percentual absoluto continua valendo nesse caso.
 */
export function forecastDisk(mount: string, samples: DiskSample[]): DiskForecast {
  const latest = samples[samples.length - 1];
  const usedGb = latest?.usedGb ?? 0;
  const totalGb = latest?.totalGb ?? 0;
  const usedPercent = totalGb > 0 ? (usedGb / totalGb) * 100 : 0;

  const base: DiskForecast = {
    mount,
    usedGb,
    totalGb,
    usedPercent,
    growthGbPerDay: null,
    daysUntilFull: null,
    sampleCount: samples.length,
  };

  if (samples.length < vmConfig.disk.minSamplesForTrend) {
    return base;
  }

  const slope = linearSlopeGbPerDay(samples);
  if (slope === null) return base;

  base.growthGbPerDay = slope;

  // Sem crescimento não há data de enchimento: só o threshold absoluto vale.
  if (slope <= 0) return base;

  const freeGb = totalGb - usedGb;
  if (freeGb <= 0) {
    base.daysUntilFull = 0;
    return base;
  }

  base.daysUntilFull = freeGb / slope;
  return base;
}

export type DiskSeverity = 'critical' | 'warning' | null;

export interface DiskEvaluation {
  severity: DiskSeverity;
  reason: string;
}

/**
 * Traduz a projeção em severidade, com a regra pedida:
 *   vermelho: uso > DISK_CRITICAL_PERCENT OU projeção < DISK_FORECAST_CRITICAL_HOURS
 *   amarelo:  uso > DISK_WARNING_PERCENT  OU projeção < DISK_FORECAST_WARNING_DAYS
 *
 * Vermelho é avaliado antes do amarelo: um disco a 95% dispara os dois limites, e
 * quem está de plantão precisa ver o vermelho.
 */
export function evaluateDisk(forecast: DiskForecast): DiskEvaluation {
  const { warningPercent, criticalPercent, forecastWarningDays, forecastCriticalHours } =
    vmConfig.disk;

  const criticalDays = forecastCriticalHours / 24;
  const pct = forecast.usedPercent;
  const days = forecast.daysUntilFull;

  if (pct > criticalPercent) {
    return { severity: 'critical', reason: `uso em ${pct.toFixed(1)}% (limite ${criticalPercent}%)` };
  }
  if (days !== null && days < criticalDays) {
    return {
      severity: 'critical',
      reason: `projeção de encher em ${formatHorizon(days)} (limite ${forecastCriticalHours}h)`,
    };
  }
  if (pct > warningPercent) {
    return { severity: 'warning', reason: `uso em ${pct.toFixed(1)}% (limite ${warningPercent}%)` };
  }
  if (days !== null && days < forecastWarningDays) {
    return {
      severity: 'warning',
      reason: `projeção de encher em ${formatHorizon(days)} (limite ${forecastWarningDays} dias)`,
    };
  }

  return { severity: null, reason: '' };
}

/** "~18 horas" / "~3,4 dias" — abaixo de 2 dias, dias com vírgula não dizem nada a quem está de plantão. */
export function formatHorizon(days: number): string {
  if (days <= 0) return 'imediatamente';
  if (days < 2) {
    const hours = days * 24;
    return `~${hours < 1 ? hours.toFixed(1) : Math.round(hours)} horas`;
  }
  return `~${days.toFixed(1)} dias`;
}
