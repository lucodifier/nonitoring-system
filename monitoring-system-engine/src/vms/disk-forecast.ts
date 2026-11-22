/**
 * Projeção de enchimento de disco.
 *
 * Porta da mesma lógica de monitoring-system-worker/src/services/disk-forecast.ts.
 * Está duplicada de propósito: são dois serviços independentes, sem pacote
 * compartilhado entre eles, e a UI precisa mostrar exatamente a mesma conta que
 * gerou o alerta no chat — número diferente na tela e na mensagem destrói a
 * confiança de quem está de plantão.
 *
 * Se mudar aqui, mude lá (e vice-versa).
 */

export interface DiskSample {
  usedGb: number;
  totalGb: number;
  collectedAt: Date;
}

export interface DiskThresholds {
  warningPercent: number;
  criticalPercent: number;
  forecastWarningDays: number;
  forecastCriticalHours: number;
  minSamplesForTrend: number;
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
 * números pequenos e o slope já sai na unidade usada na tela, GB/dia.
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
 * Projeta quando o disco enche. `samples` precisa vir em ordem cronológica.
 *
 * daysUntilFull = null quando o uso está estável ou caindo (slope <= 0):
 * projetar "enche em 40 mil dias" não ajuda ninguém.
 */
export function forecastDisk(
  mount: string,
  samples: DiskSample[],
  thresholds: DiskThresholds,
): DiskForecast {
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

  if (samples.length < thresholds.minSamplesForTrend) return base;

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
 * Traduz a projeção em severidade:
 *   vermelho: uso > criticalPercent OU projeção < forecastCriticalHours
 *   amarelo:  uso > warningPercent  OU projeção < forecastWarningDays
 *
 * Vermelho é avaliado antes do amarelo: um disco a 95% cruza os dois limites,
 * e quem está de plantão precisa ver o vermelho.
 */
export function evaluateDisk(
  forecast: DiskForecast,
  thresholds: DiskThresholds,
): DiskEvaluation {
  const { warningPercent, criticalPercent, forecastWarningDays, forecastCriticalHours } =
    thresholds;

  const criticalDays = forecastCriticalHours / 24;
  const pct = forecast.usedPercent;
  const days = forecast.daysUntilFull;

  if (pct > criticalPercent) {
    return {
      severity: 'critical',
      reason: `uso em ${pct.toFixed(1)}% (limite ${criticalPercent}%)`,
    };
  }
  if (days !== null && days < criticalDays) {
    return {
      severity: 'critical',
      reason: `projeção de encher em ${formatHorizon(days)} (limite ${forecastCriticalHours}h)`,
    };
  }
  if (pct > warningPercent) {
    return {
      severity: 'warning',
      reason: `uso em ${pct.toFixed(1)}% (limite ${warningPercent}%)`,
    };
  }
  if (days !== null && days < forecastWarningDays) {
    return {
      severity: 'warning',
      reason: `projeção de encher em ${formatHorizon(days)} (limite ${forecastWarningDays} dias)`,
    };
  }

  return { severity: null, reason: '' };
}

/** "~18 horas" / "~3.4 dias" — abaixo de 2 dias, fração de dia não diz nada a quem está de plantão. */
export function formatHorizon(days: number): string {
  if (days <= 0) return 'imediatamente';
  if (days < 2) {
    const hours = days * 24;
    return `~${hours < 1 ? hours.toFixed(1) : Math.round(hours)} horas`;
  }
  return `~${days.toFixed(1)} dias`;
}
