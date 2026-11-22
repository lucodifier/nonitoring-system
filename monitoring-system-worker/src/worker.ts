import { AppDataSource } from './data-source';
import { Service } from './entities/Service';
import { ServiceStatusCurrent } from './entities/ServiceStatusCurrent';
import { ServiceStatusHistory } from './entities/ServiceStatusHistory';
import { ServiceAlert } from './entities/ServiceAlert';
import { ServiceError } from './entities/ServiceError';
import { getServiceMetrics, ServiceMetrics } from './clients/prometheus';
import { queryLokiErrorCount, queryLokiWarningCount } from './clients/loki';
import { queryContainerLogCounts } from './clients/container-logs';
import { sendAlertNotification, getWebhookUrl } from './clients/notifier';
import { checkContainerStatus, getContainerStats, ContainerStatus, DockerConfig } from './clients/docker';
import { getDiskUsageSSH } from './clients/docker-ssh';
import { log } from './logger';
import { Pool } from 'pg';

const MONITORING_INTERVAL_MINUTES = parseInt(process.env.MONITORING_INTERVAL_MINUTES || '15');

// Thresholds configuráveis via .env (mantém defaults atuais do código)
const CPU_THRESHOLD_PERCENT = parseFloat(process.env.CPU_THRESHOLD_PERCENT || '80');
const MEMORY_THRESHOLD_MB = parseFloat(process.env.MEMORY_THRESHOLD_MB || '500');
const ERROR_THRESHOLD_COUNT = parseInt(process.env.ERROR_THRESHOLD_COUNT || '10');
const WARNING_THRESHOLD_COUNT = parseInt(process.env.WARNING_THRESHOLD_COUNT || '20');
const DISK_THRESHOLD_PERCENT = parseFloat(process.env.DISK_THRESHOLD_PERCENT || '80');

// Cooldown para alertas de disco (evitar spam): mesmo host+mount só reenvia após este intervalo (ms)
const DISK_ALERT_COOLDOWN_MS = (parseInt(process.env.MONITORING_INTERVAL_MINUTES || '15', 10) * 60) * 1000;
const lastDiskAlertSent: Record<string, number> = {};

export const processServices = async () => {
  // Uma linha por ciclo sempre visível em docker logs (stderr)
  console.warn(`[Worker] Cycle started at ${new Date().toISOString()} (Loki window: ${MONITORING_INTERVAL_MINUTES}m)`);
  log.info(`[${new Date().toISOString()}] Starting monitoring cycle... (Loki query window: ${MONITORING_INTERVAL_MINUTES} minutes)`);

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  // Criar pool de conexão PostgreSQL direto para evitar problemas com TypeORM format()
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'monitoring_system',
  });

  const serviceRepo = AppDataSource.getRepository(Service);
  const statusRepo = AppDataSource.getRepository(ServiceStatusCurrent);
  const historyRepo = AppDataSource.getRepository(ServiceStatusHistory);
  const alertRepo = AppDataSource.getRepository(ServiceAlert);
  const errorRepo = AppDataSource.getRepository(ServiceError);

  // Buscar todos os serviços ativos da tabela
  const services = await serviceRepo.find({
    where: { isActive: true },
  });

  if (services.length === 0) {
    log.info('No active services found in database');
    return;
  }

  log.info(`Found ${services.length} active service(s) to monitor`);

  for (const service of services) {
    try {
      log.info(`Processing service: ${service.name} (${service.id})`);

      // Preparar configuração Docker do serviço
      // Prioridade: SSH config > serviço específico > .env global > padrão
      const dockerConfig: DockerConfig | undefined = (() => {
        // Se tem SSH config no .env, usa SSH
        const sshHost = process.env.DOCKER_SSH_HOST;
        const sshUsername = process.env.DOCKER_SSH_USERNAME;
        if (sshHost && sshUsername) {
          return {
            ssh: {
              host: sshHost,
              port: process.env.DOCKER_SSH_PORT ? parseInt(process.env.DOCKER_SSH_PORT) : 22,
              username: sshUsername,
              password: process.env.DOCKER_SSH_PASSWORD || undefined,
              privateKey: process.env.DOCKER_SSH_PRIVATE_KEY || undefined,
            },
          };
        }

        // Senão usa configuração do serviço ou .env
        if (service.dockerHost || service.dockerSocketPath) {
          return {
            host: service.dockerHost || undefined,
            port: service.dockerPort || undefined,
            socketPath: service.dockerSocketPath || undefined,
          };
        }

        return undefined; // Usa padrão do .env
      })();

      // 1. Verificar status do container Docker (se container_id estiver configurado)
      let containerStatus: ContainerStatus | null = null;
      let containerStats: { cpuPercent: number; memoryUsage: number; memoryLimit: number; networkRx: number; networkTx: number } | null = null;

      if (service.containerId) {
        const dockerLocation = dockerConfig?.ssh
          ? `SSH: ${dockerConfig.ssh.host}:${dockerConfig.ssh.port || 22}`
          : service.dockerHost 
          ? `${service.dockerHost}:${service.dockerPort || 2375}`
          : service.dockerSocketPath || 'default (from .env or local)';
        log.info(`  Checking Docker container: ${service.containerId} (Docker: ${dockerLocation})`);
        containerStatus = await checkContainerStatus(service.containerId, dockerConfig);
        
        if (containerStatus?.error) {
          log.warn(`  ⚠️  Docker check failed: ${containerStatus.error}`);
        } else if (containerStatus) {
          log.info(`  ✓ Container status: ${containerStatus.status}`);
        }
        
        if (containerStatus?.status === 'running') {
          containerStats = await getContainerStats(service.containerId, dockerConfig);
          if (containerStats) {
            log.info(`  ✓ Container stats: CPU ${containerStats.cpuPercent.toFixed(1)}%, Memory ${containerStats.memoryUsage.toFixed(0)}MB`);
          }
        }
      }

      // 2. Coletar métricas do Prometheus (apenas se prometheus_job estiver configurado)
      let prometheusMetrics: ServiceMetrics | null = null;
      if (service.prometheusJob) {
        log.info(`  Fetching Prometheus metrics for job: ${service.prometheusJob}`);
        prometheusMetrics = await getServiceMetrics(service.prometheusJob);
        log.info(`  ✓ Prometheus metrics: up=${prometheusMetrics.up}, CPU=${prometheusMetrics.cpu.toFixed(1)}%, Memory=${prometheusMetrics.memory.toFixed(0)}MB`);
      } else {
        log.info(`  ⏭️  Prometheus not configured for this service (using Docker + Loki only)`);
      }

      // 3. Coletar contagem de erros/warnings dos logs.
      //    Fonte primária: Loki (só se LOKI_ENABLED=true).
      //    Fallback: stdout do container via `docker logs` na mesma sessão SSH que já usamos
      //    para docker ps/stats. Não depende de Loki nem de coletor de log externo, então
      //    o alerta de erro continua funcionando mesmo com a stack de logs fora do ar.
      const lokiEnabled = process.env.LOKI_ENABLED === 'true';
      let errorCount = 0;
      let warningCount = 0;
      let lastError: string | null = null;
      let logSource = 'nenhuma';

      if (lokiEnabled) {
        logSource = 'Loki';
        if (!service.lokiLabel) {
          log.warn(`  ⚠️  Loki not configured for ${service.name} (loki_label empty in DB) - error/warning count will be 0. Set loki_label to match Loki job (e.g. gs1-integration-worker).`);
        } else {
          log.info(
            `  Fetching Loki logs for env=${service.env}, container=${service.lokiLabel} (window: ${MONITORING_INTERVAL_MINUTES}m)`
          );
        }
        errorCount = await queryLokiErrorCount(
          service.env,
          service.lokiLabel,
          MONITORING_INTERVAL_MINUTES
        );
        warningCount = await queryLokiWarningCount(
          service.env,
          service.lokiLabel,
          MONITORING_INTERVAL_MINUTES
        );
        if (service.lokiLabel) {
          log.info(
            `  ✓ Loki logs (env=${service.env}, container=${service.lokiLabel}): ${errorCount} errors, ${warningCount} warnings`
          );
        }
      } else if (service.containerId) {
        logSource = 'docker logs (SSH)';
        log.info(
          `  Lendo stdout do container ${service.containerId} via SSH (janela: ${MONITORING_INTERVAL_MINUTES}m)`
        );
        const counts = await queryContainerLogCounts(
          dockerConfig?.ssh,
          service.containerId,
          MONITORING_INTERVAL_MINUTES
        );
        errorCount = counts.errorCount;
        warningCount = counts.warningCount;
        lastError = counts.lastError;
      }

      // 3b. Registrar a linha de erro em service_errors, que alimenta o painel
      //     "recent logs" da tela do serviço no dashboard (GET /services/:id/errors).
      //     A tabela existia e era lida, mas nada escrevia nela.
      if (lastError) {
        await recordServiceError(errorRepo, service, lastError, logSource);
      }

      // 4. Combinar métricas: preferir métricas do container se disponível, senão usar Prometheus (se configurado)
      const finalMetrics: ServiceMetrics & {
        containerRunning?: boolean;
        uptime?: number;
        restartCount?: number;
        disk?: number;
        networkIn?: number;
        networkOut?: number;
      } = {
        // 'up' só é relevante se Prometheus estiver configurado; senão usa status do container
        up: prometheusMetrics ? prometheusMetrics.up : (containerStatus?.status === 'running' ? 1 : 0),
        cpu: containerStats?.cpuPercent || (prometheusMetrics?.cpu || 0),
        memory: containerStats?.memoryUsage || (prometheusMetrics?.memory || 0),
        disk: prometheusMetrics?.disk,
        networkIn: containerStats?.networkRx ? containerStats.networkRx / 1024 / 1024 : undefined, // MB
        networkOut: containerStats?.networkTx ? containerStats.networkTx / 1024 / 1024 : undefined, // MB
        responseTime: prometheusMetrics?.responseTime,
        containerRunning: containerStatus?.status === 'running',
        uptime: containerStatus?.uptime,
        restartCount: 0, // TODO: rastrear restarts
      };

      // 5. Determinar status do serviço
      let status = 'UP';
      let statusReason = '';

      // IMPORTANTE: Só marcar como DOWN se realmente encontrar que está parado
      // Não marcar como DOWN se houver erro de conexão (status === 'unknown')
      
      // Se container configurado E conseguimos verificar
      if (service.containerId && containerStatus) {
        if (containerStatus.status === 'running') {
          // Container está rodando - OK
          // status já é 'UP' por padrão
          log.info(`  ✓ Container ${service.containerId} is running - status will be UP`);
        } else if (containerStatus.status === 'stopped' && containerStatus.error) {
          // Container não foi encontrado ou está parado
          // Se o erro indica "not found", pode ser que o nome está diferente
          log.warn(`  ⚠️  Container ${service.containerId} status: ${containerStatus.status}, error: ${containerStatus.error}`);
          status = 'DOWN';
          statusReason = `Container ${service.containerId} ${containerStatus.error.includes('not found') ? 'not found' : `is ${containerStatus.status}`}`;
        } else if (containerStatus.status !== 'unknown') {
          // Container foi encontrado mas não está rodando (exited, paused, etc)
          status = 'DOWN';
          statusReason = `Container ${service.containerId} is ${containerStatus.status}`;
          log.warn(`  ✗ Container ${service.containerId} is ${containerStatus.status} - marking as DOWN`);
        }
        // Se status for 'unknown', não marca como DOWN (pode ser erro de conexão)
      } else if (service.containerId && !containerStatus) {
        // Container configurado mas não conseguimos verificar (erro de conexão)
        log.warn(`  ⚠️  Could not check container ${service.containerId} - connection error, status will remain ${status}`);
      }
      // Se Prometheus indica down (APENAS se prometheus_job estiver configurado E container não foi verificado)
      // IMPORTANTE: Se o container está rodando, prioriza o Docker sobre Prometheus
      if (status === 'UP' && !containerStatus && prometheusMetrics && prometheusMetrics.up === 0 && service.prometheusJob) {
        // Só usa Prometheus se não conseguimos verificar o container
        status = 'DOWN';
        statusReason = 'Prometheus indicates service is down';
        log.warn(`  ✗ Prometheus indicates ${service.name} is down (no Docker check available)`);
      } else if (status === 'UP' && containerStatus?.status === 'running' && prometheusMetrics && prometheusMetrics.up === 0 && service.prometheusJob) {
        // Container está rodando mas Prometheus diz que está down - pode ser que métricas não estão expostas
        // Não marca como DOWN, mas pode marcar como DEGRADED se necessário
        log.warn(`  ⚠️  Container is running but Prometheus indicates down - service may not be exposing metrics`);
      }
      // Se há muitos erros ou recursos altos
      else if (errorCount > ERROR_THRESHOLD_COUNT || finalMetrics.cpu > CPU_THRESHOLD_PERCENT || finalMetrics.memory > MEMORY_THRESHOLD_MB) {
        status = 'DEGRADED';
        statusReason = errorCount > ERROR_THRESHOLD_COUNT
          ? `High error count: ${errorCount}`
          : finalMetrics.cpu > CPU_THRESHOLD_PERCENT
          ? `High CPU: ${finalMetrics.cpu.toFixed(1)}%`
          : `High memory: ${finalMetrics.memory.toFixed(0)}MB`;
      }
      // Se há warnings mas não é crítico
      else if (warningCount > WARNING_THRESHOLD_COUNT) {
        status = 'DEGRADED';
        statusReason = `High warning count: ${warningCount}`;
      }

      // 6. Buscar status atual existente
      const existingStatus = await statusRepo.findOne({
        where: { serviceId: service.id },
      });

      const previousStatus = existingStatus?.status || 'UNKNOWN';
      const statusChanged = previousStatus !== status;

      // 7. Atualizar ou criar status atual (UPSERT)
      // Função helper para garantir valores numéricos válidos
      const safeNumber = (val: any): number | null => {
        if (val === undefined || val === null) return null;
        const num = typeof val === 'number' ? val : parseFloat(val);
        return (isNaN(num) || !isFinite(num)) ? null : num;
      };
      
      const currentStatus = existingStatus || new ServiceStatusCurrent();
      currentStatus.serviceId = service.id;
      currentStatus.status = status;
      
      // Garantir que todos os valores numéricos sejam numbers válidos ou null (nunca undefined, NaN ou Infinity)
      // Para campos 'real' no PostgreSQL, garantir que sejam números ou null explicitamente
      const cpuUsage = safeNumber(finalMetrics.cpu);
      currentStatus.cpuUsage = cpuUsage !== null ? Number(cpuUsage) : null;
      
      const memoryUsage = safeNumber(finalMetrics.memory);
      currentStatus.memoryUsage = memoryUsage !== null ? Number(memoryUsage) : null;
      
      const diskUsage = safeNumber(finalMetrics.disk);
      currentStatus.diskUsage = diskUsage !== null ? Number(diskUsage) : null;
      
      const networkIn = safeNumber(finalMetrics.networkIn);
      currentStatus.networkIn = networkIn !== null ? Number(networkIn) : null;
      
      const networkOut = safeNumber(finalMetrics.networkOut);
      currentStatus.networkOut = networkOut !== null ? Number(networkOut) : null;
      // Garantir que campos int sempre sejam números inteiros válidos (não podem ser null)
      currentStatus.errorCount = Math.max(0, Math.floor(safeNumber(errorCount) ?? 0));
      currentStatus.warningCount = Math.max(0, Math.floor(safeNumber(warningCount) ?? 0));
      currentStatus.restartCount = Math.max(0, Math.floor(safeNumber(finalMetrics.restartCount) ?? 0));
      // responseTimeMs é int nullable - garantir que seja inteiro ou null
      const responseTime = safeNumber(finalMetrics.responseTime);
      currentStatus.responseTimeMs = responseTime !== null ? Math.max(0, Math.round(responseTime)) : null;
      // uptimeSeconds é bigint nullable - garantir que seja inteiro positivo ou null
      const uptime = safeNumber(finalMetrics.uptime);
      currentStatus.uptimeSeconds = uptime !== null && uptime >= 0 ? Math.floor(uptime) : null;
      currentStatus.lastCheck = new Date();
      
      if (statusChanged) {
        currentStatus.lastChange = new Date();
      } else if (!currentStatus.lastChange && existingStatus) {
        currentStatus.lastChange = existingStatus.lastCheck || new Date();
      }

      // Metadata com informações adicionais
      // Garantir que todos os valores são serializáveis (sem undefined, NaN, Infinity)
      // E garantir que strings não tenham caracteres problemáticos
      const cleanString = (str: any): string | null => {
        if (str === undefined || str === null) return null;
        const s = String(str);
        // Remover caracteres de controle e substituir por string vazia se necessário
        return s.replace(/[\x00-\x1F\x7F]/g, '').trim() || null;
      };

      currentStatus.metadata = {
        containerStatus: cleanString(containerStatus?.status),
        containerError: cleanString(containerStatus?.error),
        containerId: cleanString(service.containerId),
        // ID real do container no Docker, que muda a cada redeploy. Usado para montar
        // o link do Dozzle, cuja rota e /container/<id> -- nome nao resolve.
        // Por mudar sempre, nao pode ser guardado em services.container_id: tem que ser
        // recoletado a cada ciclo, junto com o status.
        containerRuntimeId: cleanString(containerStatus?.id),
        dockerHost: cleanString(service.dockerHost),
        prometheusJob: cleanString(service.prometheusJob),
        prometheusEnabled: !!service.prometheusJob,
        lokiLabel: cleanString(service.lokiLabel),
        statusReason: cleanString(statusReason),
        thresholds: {
          cpuPercent: CPU_THRESHOLD_PERCENT,
          memoryMb: MEMORY_THRESHOLD_MB,
          errorCount: ERROR_THRESHOLD_COUNT,
          warningCount: WARNING_THRESHOLD_COUNT,
        },
      };

      // Salvar usando conexão PostgreSQL direta para evitar problemas com TypeORM format()
      try {
        // Remover casts explícitos - deixar PostgreSQL inferir tipos automaticamente
        await pool.query(
            `INSERT INTO monitoring.service_status_current (
              service_id, status, cpu_usage, memory_usage, disk_usage,
              network_in, network_out, error_count, warning_count, restart_count,
              response_time_ms, uptime_seconds, last_change, last_check, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (service_id) DO UPDATE SET
              status = EXCLUDED.status,
              cpu_usage = EXCLUDED.cpu_usage,
              memory_usage = EXCLUDED.memory_usage,
              disk_usage = EXCLUDED.disk_usage,
              network_in = EXCLUDED.network_in,
              network_out = EXCLUDED.network_out,
              error_count = EXCLUDED.error_count,
              warning_count = EXCLUDED.warning_count,
              restart_count = EXCLUDED.restart_count,
              response_time_ms = EXCLUDED.response_time_ms,
              uptime_seconds = EXCLUDED.uptime_seconds,
              last_change = EXCLUDED.last_change,
              last_check = EXCLUDED.last_check,
              metadata = EXCLUDED.metadata`,
            [
              currentStatus.serviceId,
              currentStatus.status,
              currentStatus.cpuUsage ?? null,
              currentStatus.memoryUsage ?? null,
              currentStatus.diskUsage ?? null,
              currentStatus.networkIn ?? null,
              currentStatus.networkOut ?? null,
              currentStatus.errorCount ?? 0,
              currentStatus.warningCount ?? 0,
              currentStatus.restartCount ?? 0,
              currentStatus.responseTimeMs ?? null,
              currentStatus.uptimeSeconds ?? null,
              currentStatus.lastChange ?? null,
              currentStatus.lastCheck,
              currentStatus.metadata ? JSON.stringify(currentStatus.metadata) : null,
            ]
        );
      } catch (saveError: any) {
        log.error(`  ✗ Error saving status to database: ${saveError.message}`);
        log.error(`  Current status values:`, {
          serviceId: currentStatus.serviceId,
          status: currentStatus.status,
          cpuUsage: currentStatus.cpuUsage,
          memoryUsage: currentStatus.memoryUsage,
          diskUsage: currentStatus.diskUsage,
          networkIn: currentStatus.networkIn,
          networkOut: currentStatus.networkOut,
          errorCount: currentStatus.errorCount,
          warningCount: currentStatus.warningCount,
          restartCount: currentStatus.restartCount,
          responseTimeMs: currentStatus.responseTimeMs,
          uptimeSeconds: currentStatus.uptimeSeconds,
        });
        throw saveError;
      }

      // 8. Salvar no histórico sempre (para análise temporal) - usar query raw também
      const historyCpuUsage = safeNumber(finalMetrics.cpu);
      const historyMemoryUsage = safeNumber(finalMetrics.memory);
      const historyDiskUsage = safeNumber(finalMetrics.disk);
      const historyNetworkIn = safeNumber(finalMetrics.networkIn);
      const historyNetworkOut = safeNumber(finalMetrics.networkOut);
      const historyResponseTime = safeNumber(finalMetrics.responseTime);
      const historyUptime = safeNumber(finalMetrics.uptime);
      
      // Salvar histórico usando conexão PostgreSQL direta
      await pool.query(
        `INSERT INTO monitoring.service_status_history (
          service_id, status, cpu_usage, memory_usage, disk_usage,
          network_in, network_out, error_count, warning_count,
          response_time_ms, uptime_seconds, checked_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          service.id,
          status,
          historyCpuUsage ?? null,
          historyMemoryUsage ?? null,
          historyDiskUsage ?? null,
          historyNetworkIn ?? null,
          historyNetworkOut ?? null,
          errorCount ?? 0,
          warningCount ?? 0,
          historyResponseTime !== null ? Math.round(historyResponseTime) : null,
          historyUptime !== null ? Math.floor(historyUptime) : null,
          new Date(),
          currentStatus.metadata ? JSON.stringify(currentStatus.metadata) : null,
        ]
      );

      // 9. Gerar alertas se necessário
      if (status !== 'UP' || errorCount > 0) {
        log.warn(`[Alert] Checking: ${service.name} status=${status} errors=${errorCount} (fonte: ${logSource})`);
        await checkAndCreateAlert(
          alertRepo,
          service,
          status,
          previousStatus,
          finalMetrics,
          errorCount,
          warningCount,
          statusReason,
          lastError
        );
      }

      log.info(
        `✓ ${service.name}: ${status} | CPU: ${finalMetrics.cpu.toFixed(1)}% | ` +
        `Mem: ${finalMetrics.memory.toFixed(0)}MB | Errs: ${errorCount} | Warnings: ${warningCount}`
      );

    } catch (error: any) {
      log.error(`Error processing ${service.name} (${service.id}):`, error.message);
      if (error.stack) {
        log.error(error.stack);
      }
    }
  }

  // Checagem de disco no host SSH (DOCKER_SSH_HOST): alerta Discord se > DISK_THRESHOLD_PERCENT
  const sshHost = process.env.DOCKER_SSH_HOST;
  const sshUsername = process.env.DOCKER_SSH_USERNAME;
  if (sshHost && sshUsername) {
    try {
      const sshConfig = {
        host: sshHost,
        port: process.env.DOCKER_SSH_PORT ? parseInt(process.env.DOCKER_SSH_PORT) : 22,
        username: sshUsername,
        password: process.env.DOCKER_SSH_PASSWORD || undefined,
        privateKey: process.env.DOCKER_SSH_PRIVATE_KEY || undefined,
      };
      const diskEntries = await getDiskUsageSSH(sshConfig);
      for (const entry of diskEntries) {
        if (entry.usedPercent >= DISK_THRESHOLD_PERCENT) {
          log.warn(`[Disk] Host ${sshHost} mount ${entry.mount} at ${entry.usedPercent}% (threshold ${DISK_THRESHOLD_PERCENT}%)`);
          const key = `${sshHost}:${entry.mount}`;
          const now = Date.now();
          if (!lastDiskAlertSent[key] || now - lastDiskAlertSent[key] >= DISK_ALERT_COOLDOWN_MS) {
            await sendDiscordDiskAlert(sshHost, entry.mount, entry.usedPercent);
            lastDiskAlertSent[key] = now;
          }
        }
      }
    } catch (diskErr: any) {
      log.error('[Disk] Failed to check disk usage via SSH:', diskErr.message);
    }
  }

  // Fechar pool de conexão PostgreSQL
  await pool.end();

  log.info(`[${new Date().toISOString()}] Cycle completed.`);
};

/**
 * Grava o erro observado, evitando repetir a mesma mensagem a cada ciclo.
 *
 * Sem deduplicação isso viraria uma linha por serviço por minuto enquanto o erro
 * durasse. Só grava quando a mensagem muda em relação ao último registro não
 * resolvido daquele serviço — a consulta só roda quando há erro, então no caminho
 * feliz não custa nada.
 */
async function recordServiceError(
  repo: any,
  service: Service,
  errorMessage: string,
  source: string
) {
  try {
    const last = await repo.findOne({
      where: { serviceId: service.id },
      order: { occurredAt: 'DESC' },
    });

    if (last && last.errorMessage === errorMessage) {
      return; // mesma mensagem do último registro: nada novo a contar
    }

    const entry = new ServiceError();
    entry.serviceId = service.id;
    entry.errorMessage = errorMessage;
    entry.errorType = 'log';
    entry.errorLevel = 'error';
    entry.isResolved = false;
    entry.context = { source, env: service.env, container: service.containerId };

    await repo.save(entry);
    log.info(`  ✓ service_errors: novo erro registrado para ${service.name}`);
  } catch (err: any) {
    // Visibilidade não pode derrubar o ciclo de monitoramento.
    log.error(`  ✗ Falha ao gravar service_errors de ${service.name}: ${err.message}`);
  }
}

function getAlertTitleAndMessage(
  serviceName: string,
  currentStatus: string,
  alertType: string,
  errorCount: number,
  warningCount: number,
  statusReason: string,
  metrics: any,
  lastError?: string | null
): { title: string; message: string } {
  // A amostra do erro é o que transforma "12 erros" em algo acionável sem abrir o Dozzle.
  const errorSample = lastError ? ` | Último erro: ${lastError}` : '';
  const baseInfo = `CPU: ${metrics.cpu.toFixed(1)}%, Memory: ${metrics.memory.toFixed(0)}MB, Errors: ${errorCount}, Warnings: ${warningCount}${errorSample}`;
  if (alertType === 'down') {
    return {
      title: `${serviceName} is DOWN`,
      message: statusReason ? `${statusReason}. ${baseInfo}` : baseInfo,
    };
  }
  if (alertType === 'degraded') {
    return {
      title: `${serviceName} is DEGRADED`,
      message: statusReason ? `${statusReason}. ${baseInfo}` : baseInfo,
    };
  }
  if (alertType === 'error' && currentStatus === 'UP') {
    return {
      title: `${serviceName}: errors in logs (${errorCount} errors)`,
      message: statusReason ? `${statusReason}. ${baseInfo}` : baseInfo,
    };
  }
  if (alertType === 'high_cpu') {
    return {
      title: `${serviceName}: high CPU (${metrics.cpu.toFixed(1)}%)`,
      message: statusReason ? `${statusReason}. ${baseInfo}` : baseInfo,
    };
  }
  if (alertType === 'high_memory') {
    return {
      title: `${serviceName}: high memory (${metrics.memory.toFixed(0)}MB)`,
      message: statusReason ? `${statusReason}. ${baseInfo}` : baseInfo,
    };
  }
  // fallback
  return {
    title: `${serviceName} is ${currentStatus}`,
    message: statusReason ? `${statusReason}. ${baseInfo}` : baseInfo,
  };
}

async function checkAndCreateAlert(
  repo: any,
  service: Service,
  currentStatus: string,
  previousStatus: string,
  metrics: any,
  errorCount: number,
  warningCount: number,
  statusReason: string,
  lastError?: string | null
) {
  // Determinar tipo e severidade do alerta
  let alertType = 'error';
  let severity = 'warning';

  if (currentStatus === 'DOWN') {
    alertType = 'down';
    severity = 'critical';
  } else if (currentStatus === 'DEGRADED') {
    alertType = 'degraded';
    severity = 'warning';
  } else if (errorCount > ERROR_THRESHOLD_COUNT) {
    alertType = 'error';
    severity = 'critical';
  } else if (errorCount > 0 && currentStatus === 'UP') {
    alertType = 'error';
    severity = 'warning';
  } else if (metrics.cpu > CPU_THRESHOLD_PERCENT) {
    alertType = 'high_cpu';
    severity = 'warning';
  } else if (metrics.memory > MEMORY_THRESHOLD_MB) {
    alertType = 'high_memory';
    severity = 'warning';
  }

  // Verificar se já existe alerta não resolvido para este tipo
  const existingAlert = await repo.findOne({
    where: {
      serviceId: service.id,
      alertType,
      resolved: false,
    },
    order: { createdAt: 'DESC' },
  });

  const shouldCreateOrUpdate =
    previousStatus === 'UP' ||
    (previousStatus === 'UNKNOWN' && currentStatus !== 'UP') ||
    (currentStatus === 'UP' && errorCount > 0);

  if (!shouldCreateOrUpdate) {
    log.warn(
      `[Alert] Skipped (shouldCreateOrUpdate=false): ${service.name} prev=${previousStatus} curr=${currentStatus} errors=${errorCount}`
    );
    return;
  }

  const titleAndMessage = getAlertTitleAndMessage(service.name, currentStatus, alertType, errorCount, warningCount, statusReason, metrics, lastError);
  const newMetadata = {
    previousStatus,
    currentStatus,
    errorCount,
    warningCount,
    thresholds: {
      cpuPercent: CPU_THRESHOLD_PERCENT,
      memoryMb: MEMORY_THRESHOLD_MB,
      errorCount: ERROR_THRESHOLD_COUNT,
      warningCount: WARNING_THRESHOLD_COUNT,
    },
  };

  if (existingAlert) {
    const meta = (existingAlert.metadata as any) || {};
    const previousErrorCount = meta.errorCount ?? -1;
    // Reenviar ao Discord só quando a contagem de erros mudar (evita mesma mensagem várias vezes)
    const shouldResend = errorCount !== previousErrorCount;

    existingAlert.title = titleAndMessage.title;
    existingAlert.message = titleAndMessage.message;
    existingAlert.currentValue =
      errorCount > ERROR_THRESHOLD_COUNT ? errorCount :
      warningCount > WARNING_THRESHOLD_COUNT ? warningCount :
      metrics.cpu > CPU_THRESHOLD_PERCENT ? metrics.cpu :
      metrics.memory > MEMORY_THRESHOLD_MB ? metrics.memory : null;
    existingAlert.metadata = newMetadata;
    await repo.save(existingAlert);

    if (shouldResend) {
      await sendDiscordNotification(existingAlert, service);
    }
    return;
  }

  // Criar novo alerta
  log.warn(`[Alert] Creating new: ${service.name} type=${alertType} errors=${errorCount}`);
  const alert = new ServiceAlert();
  alert.serviceId = service.id;
  alert.alertType = alertType;
  alert.severity = severity;
  alert.title = titleAndMessage.title;
  alert.message = titleAndMessage.message;
  alert.thresholdValue =
    metrics.cpu > CPU_THRESHOLD_PERCENT ? CPU_THRESHOLD_PERCENT :
    metrics.memory > MEMORY_THRESHOLD_MB ? MEMORY_THRESHOLD_MB :
    errorCount > ERROR_THRESHOLD_COUNT ? ERROR_THRESHOLD_COUNT :
    warningCount > WARNING_THRESHOLD_COUNT ? WARNING_THRESHOLD_COUNT :
    null;
  alert.currentValue =
    metrics.cpu > CPU_THRESHOLD_PERCENT ? metrics.cpu :
    metrics.memory > MEMORY_THRESHOLD_MB ? metrics.memory :
    errorCount > ERROR_THRESHOLD_COUNT ? errorCount :
    warningCount > WARNING_THRESHOLD_COUNT ? warningCount :
    null;
  alert.resolved = false;
  alert.notified = false;
  alert.acknowledged = false;
  alert.metadata = newMetadata;

  try {
    await repo.save(alert);
  } catch (saveErr: any) {
    log.error(`[Alert] Failed to save alert for ${service.name}:`, saveErr.message);
    throw saveErr;
  }
  log.warn(`[Alert] Sending to Discord: ${service.name} alertId=${alert.id}`);
  await sendDiscordNotification(alert, service);
}

/** Cooldown por serviço+tipo de alerta, para não repetir a mesma notificação todo ciclo. */
const ALERT_RESEND_COOLDOWN_MS =
  parseInt(process.env.ALERT_RESEND_COOLDOWN_MINUTES || '30', 10) * 60 * 1000;
const lastAlertSent: Record<string, number> = {};

async function sendDiscordNotification(alert: ServiceAlert, service: Service) {
  if (!getWebhookUrl()) {
    log.warn('ALERT_WEBHOOK_URL/DISCORD_WEBHOOK_URL not set - no alert will be sent.');
    return;
  }

  // O ciclo roda a cada minuto e o errorCount oscila (erros entram e saem da janela),
  // então "reenviar quando a contagem mudar" dispararia quase todo minuto enquanto o
  // serviço estiver ruim. Canal que apita demais vira canal silenciado.
  const key = `${service.id}:${alert.alertType}`;
  const now = Date.now();
  if (lastAlertSent[key] && now - lastAlertSent[key] < ALERT_RESEND_COOLDOWN_MS) {
    log.info(`[Alert] Em cooldown, não reenviado: ${key}`);
    return;
  }

  const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
  const end = new Date();
  const start = new Date(end.getTime() - MONITORING_INTERVAL_MINUTES * 60 * 1000);

  const sent = await sendAlertNotification({
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    serviceName: service.name,
    serviceType: service.type,
    env: service.env,
    timestamp: alert.createdAt.toISOString(),
    serviceLink: `${dashboardUrl}/services/${service.id}`,
    logsLink: `${dashboardUrl}/logs?service=${service.id}&start=${start.toISOString()}&end=${end.toISOString()}`,
  });

  if (!sent) return;

  lastAlertSent[key] = now;
  alert.notified = true;
  const alertRepo = AppDataSource.getRepository(ServiceAlert);
  await alertRepo.save(alert);
}

async function sendDiscordDiskAlert(host: string, mount: string, usedPercent: number) {
  if (!getWebhookUrl()) {
    log.warn('ALERT_WEBHOOK_URL/DISCORD_WEBHOOK_URL not set - disk alert not sent.');
    return;
  }

  const severity = usedPercent >= 90 ? 'critical' : 'warning';

  await sendAlertNotification({
    severity,
    title: `Disco acima de ${DISK_THRESHOLD_PERCENT}% em ${host}`,
    message: `Host ${host} - mount ${mount} em ${usedPercent}% de uso (limite: ${DISK_THRESHOLD_PERCENT}%).`,
    serviceName: host,
    serviceType: 'host',
    env: process.env.NODE_ENV || 'production',
    timestamp: new Date().toISOString(),
  });
}
