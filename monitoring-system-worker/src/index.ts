import * as cron from 'node-cron';
import * as dotenv from 'dotenv';
import { processServices } from './worker';
import { processVms } from './vm-worker';
import { startHeartbeatServer } from './http/server';
import { AppDataSource } from './data-source';
import { vmConfig } from './config/vm-config';
import { log } from './logger';

dotenv.config({ quiet: true });

// Default: a cada 15 minutos (0 */15 * * * * seria a cada 15 minutos, mas cron não suporta segundos)
// Para 15 minutos: */15 * * * *
const CRON_EXPRESSION = process.env.CRON_EXPRESSION || '*/15 * * * *'; // Default: a cada 15 minutos

async function bootstrap() {
  try {
    // Sempre visível em docker logs (stderr) para debug em prod
    console.warn(
      `[Worker] Started. LOG_LEVEL=${process.env.LOG_LEVEL || '(default)'} DISCORD_WEBHOOK_URL=${process.env.DISCORD_WEBHOOK_URL ? 'set' : 'NOT SET'} VM_MONITORING=${vmConfig.enabled ? 'on' : 'off'}`
    );
    log.info('Initializing Database Connection...');
    await AppDataSource.initialize();
    log.info('Database connected successfully.');
    log.info(`Starting Monitoring Worker with schedule: ${CRON_EXPRESSION}`);

    // Executar imediatamente na inicialização
    await processServices();

    // Agendar execução periódica
    cron.schedule(CRON_EXPRESSION, async () => {
      await processServices();
    });

    // Monitoramento de VMs: ciclo próprio, mais curto que o de serviços (default 2min).
    // Fica em cron separado de propósito -- uma VM parada precisa ser vista rápido, e
    // o ciclo de serviços em prod está em janela bem maior.
    if (vmConfig.enabled) {
      log.info(`Starting VM monitoring with schedule: ${vmConfig.cronExpression}`);

      // Falha ao abrir a porta e fatal: sem heartbeat o ciclo dispararia
      // 'no_heartbeat' para todas as VMs em 15 minutos. Melhor o container
      // reiniciar (restart: unless-stopped) do que alertar em massa e errado.
      try {
        await startHeartbeatServer();
      } catch (err: any) {
        log.error(`[Heartbeat] Nao foi possivel abrir a porta: ${err.message}`);
        throw err;
      }

      // Não faz await: uma sondagem SSH lenta no primeiro ciclo não pode atrasar o
      // agendamento dos crons.
      processVms().catch((err) => log.error('[VM] Falha no ciclo inicial:', err.message));

      cron.schedule(vmConfig.cronExpression, async () => {
        try {
          await processVms();
        } catch (err: any) {
          log.error('[VM] Falha no ciclo de VMs:', err.message);
        }
      });
    } else {
      log.info('VM monitoring desabilitado (VM_MONITORING_ENABLED != true).');
    }
  } catch (error) {
    log.error('Fatal Error during startup:', error);
    process.exit(1);
  }
}

bootstrap();
