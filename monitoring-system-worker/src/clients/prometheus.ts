import axios from 'axios';
import * as dotenv from 'dotenv';
import { log } from '../logger';

dotenv.config({ quiet: true });

// URL do Prometheus (única para todos os serviços, configurada via .env)
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090';
log.info(`Prometheus URL configured: ${PROMETHEUS_URL}`);

export const queryPrometheus = async (query: string) => {
  const url = PROMETHEUS_URL;
  try {
    log.info(`  Querying Prometheus at ${url}: ${query}`);
    const response = await axios.get(`${url}/api/v1/query`, {
      params: { query },
      timeout: 10000,
    });
    const results = response.data?.data?.result || [];
    if (results.length > 0) {
      log.info(`  ✓ Prometheus returned ${results.length} result(s)`);
    } else {
      log.warn(`  ⚠️  Prometheus returned no results for query: ${query}`);
    }
    return results;
  } catch (error: any) {
    log.error(`  ✗ Error querying Prometheus at ${url}: ${error.message}`);
    if (error.response) {
      log.error(`  Response status: ${error.response.status}`);
      log.error(`  Response data:`, error.response.data);
    }
    return [];
  }
};

export interface ServiceMetrics {
  up: number;
  cpu: number;
  memory: number;
  disk?: number;
  networkIn?: number;
  networkOut?: number;
  responseTime?: number;
}

export const getServiceMetrics = async (prometheusJob: string | null): Promise<ServiceMetrics> => {
  // Se não houver prometheus_job configurado, retorna valores padrão
  if (!prometheusJob) {
    return {
      up: 0,
      cpu: 0,
      memory: 0,
    };
  }

  try {
    // Queries para métricas do serviço
    const upQuery = `up{job="${prometheusJob}"}`;
    const cpuQuery = `rate(process_cpu_seconds_total{job="${prometheusJob}"}[5m]) * 100`;
    const memoryQuery = `process_resident_memory_bytes{job="${prometheusJob}"} / 1024 / 1024`;
    
    // Queries opcionais
    const diskQuery = `node_filesystem_avail_bytes{mountpoint="/",job="${prometheusJob}"} / 1024 / 1024 / 1024`;
    const responseTimeQuery = `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="${prometheusJob}"}[5m])) * 1000`;

    const [upResult, cpuResult, memoryResult, diskResult, responseTimeResult] = await Promise.all([
      queryPrometheus(upQuery),
      queryPrometheus(cpuQuery),
      queryPrometheus(memoryQuery),
      queryPrometheus(diskQuery),
      queryPrometheus(responseTimeQuery),
    ]);

    // Para 'up', verifica se há pelo menos um resultado com valor 1
    const up = upResult.length > 0 && upResult.some((r: any) => parseInt(r.value[1]) === 1) ? 1 : 0;
    
    // CPU e Memory - pega a média se houver múltiplos resultados
    const cpu = cpuResult.length > 0 
      ? cpuResult.reduce((sum: number, r: any) => sum + parseFloat(r.value[1]), 0) / cpuResult.length
      : 0;
    
    const memory = memoryResult.length > 0
      ? memoryResult.reduce((sum: number, r: any) => sum + parseFloat(r.value[1]), 0) / memoryResult.length
      : 0;

    const disk = diskResult.length > 0 ? parseFloat(diskResult[0].value[1]) : undefined;
    const responseTime = responseTimeResult.length > 0 ? parseFloat(responseTimeResult[0].value[1]) : undefined;

    return {
      up,
      cpu: Math.round(cpu * 100) / 100,
      memory: Math.round(memory * 100) / 100,
      disk,
      responseTime,
    };
  } catch (error: any) {
    log.error(`Error getting Prometheus metrics for ${prometheusJob}:`, error.message);
    return {
      up: 0,
      cpu: 0,
      memory: 0,
    };
  }
};
