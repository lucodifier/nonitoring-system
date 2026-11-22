import axios from 'axios';
import * as dotenv from 'dotenv';
import { log } from '../logger';

dotenv.config({ quiet: true });

// Loki foi descontinuado (logs são acompanhados via stdout/Dozzle). Desabilitado por padrão;
// só tenta conectar se LOKI_ENABLED=true for definido explicitamente no .env.
const LOKI_ENABLED = process.env.LOKI_ENABLED === 'true';
const LOKI_URL = process.env.LOKI_URL || 'http://localhost:3100';

if (LOKI_ENABLED) {
  log.info(`Loki URL configured: ${LOKI_URL}`);
} else {
  log.info('Loki disabled (LOKI_ENABLED != true) - error/warning counts from logs will be 0');
}

/**
 * Normaliza o valor de env vindo do Service para o label do Loki.
 * Ex: 'production' -> 'prod', 'staging' -> 'stg', 'development' -> 'dev'
 */
const normalizeEnvForLoki = (env: string | null | undefined): string | null => {
  if (!env) return null;
  const lower = env.toLowerCase();

  if (lower.startsWith('prod')) return 'prod';
  if (lower.startsWith('stag')) return 'stg';
  if (lower.startsWith('dev')) return 'dev';

  // Caso já venha como 'prod' | 'stg' | 'dev' ou outro valor válido, retorna como está
  return env;
};

/**
 * Conta logs de erro nos últimos X minutos
 */
export const queryLokiErrorCount = async (
  env: string | null,
  containerLabel: string | null,
  minutes: number = 15
): Promise<number> => {
  if (!LOKI_ENABLED) {
    return 0;
  }

  const normalizedEnv = normalizeEnvForLoki(env);
  if (!normalizedEnv || !containerLabel) {
    return 0;
  }

  const url = LOKI_URL;

  try {
    // Query para contar logs de erro nos últimos X minutos.
    // Inclui: error, Erro (PT), exception, failed, 504/timeout (Gateway Time-out) — com \\b
    // (fronteira de palavra) para não casar métricas tipo "ack_failed_files=0", e tag Serilog ERR/FTL.
    // O !~ exclui linhas que o próprio app marcou como INF/DBG/VRB/WRN (Serilog): se o app
    // declarou a linha como info, o texto dela não deve contar como erro.
    const query = `sum(count_over_time({env="${normalizedEnv}", container="${containerLabel}"} |~ "(?i)\\\\b(error|erro|exception|failed|504|timeout|time-out)\\\\b|(ERR|FTL)\\\\]|gateway.time" !~ "\\\\[[^]]+ (INF|DBG|VRB|WRN)\\\\]" [${minutes}m]))`;
    
    log.info(
      `  Querying Loki at ${url} for errors (env=${normalizedEnv}, container=${containerLabel}, window=${minutes}m): ${query}`
    );
    const response = await axios.get(`${url}/loki/api/v1/query`, {
      params: { query },
      timeout: 30000,
    });

    const result = response.data?.data?.result || [];
    if (result.length > 0 && result[0].value) {
      const count = parseInt(result[0].value[1]) || 0;
      log.info(`  ✓ Loki returned ${count} errors for env=${normalizedEnv}, container=${containerLabel}`);
      return count;
    }
    log.warn(`  ⚠️  Loki returned no results for errors query (env=${normalizedEnv}, container=${containerLabel})`);
    return 0;
  } catch (error: any) {
    log.error(
      `  ✗ Error querying Loki at ${url} for env=${normalizedEnv}, container=${containerLabel}:`,
      error.message
    );
    if (error.response) {
      log.error(`  Response status: ${error.response.status}`);
      log.error(`  Response data:`, error.response.data);
    }
    return 0;
  }
};

/**
 * Conta logs de warning nos últimos X minutos
 */
export const queryLokiWarningCount = async (
  env: string | null,
  containerLabel: string | null,
  minutes: number = 15
): Promise<number> => {
  if (!LOKI_ENABLED) {
    return 0;
  }

  const normalizedEnv = normalizeEnvForLoki(env);
  if (!normalizedEnv || !containerLabel) {
    return 0;
  }

  const url = LOKI_URL;

  try {
    const query = `sum(count_over_time({env="${normalizedEnv}", container="${containerLabel}"} |~ "(?i)\\\\bwarn(ing)?\\\\b|WRN\\\\]" [${minutes}m]))`;
    
    log.info(
      `  Querying Loki at ${url} for warnings (env=${normalizedEnv}, container=${containerLabel}, window=${minutes}m): ${query}`
    );
    const response = await axios.get(`${url}/loki/api/v1/query`, {
      params: { query },
      timeout: 10000,
    });

    const result = response.data?.data?.result || [];
    if (result.length > 0 && result[0].value) {
      const count = parseInt(result[0].value[1]) || 0;
      return count;
    }
    return 0;
  } catch (error: any) {
    log.error(`  ✗ Error querying Loki warnings at ${url} for ${containerLabel}:`, error.message);
    if (error.response) {
      log.error(`  Response status: ${error.response.status}`);
    }
    return 0;
  }
};
