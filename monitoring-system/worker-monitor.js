import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

// ==================== CONFIGURAÇÕES ====================
function formatDurationLong(ms) {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms % day === 0 && ms >= day) {
    const days = Math.round(ms / day);
    return days === 1 ? '1 dia' : `${days} dias`;
  }
  if (ms % hour === 0 && ms >= hour) {
    const hours = Math.round(ms / hour);
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  const minutes = Math.round(ms / minute);
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}

function formatDurationShort(ms) {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms % day === 0 && ms >= day) {
    return `${Math.round(ms / day)}d`;
  }
  if (ms % hour === 0 && ms >= hour) {
    return `${Math.round(ms / hour)}h`;
  }
  return `${Math.round(ms / minute)}m`;
}

const envIntervalMs = (() => {
  const minutes = parseInt(process.env.CHECK_INTERVAL_MINUTES || '', 10);
  if (!Number.isNaN(minutes) && minutes > 0) return minutes * 60 * 1000;
  return null;
})();

const CHECK_INTERVAL_MS = envIntervalMs ?? 15 * 60 * 1000; // default 15m
const PERIOD_LONG_LABEL = formatDurationLong(CHECK_INTERVAL_MS);
const PERIOD_SHORT_LABEL = formatDurationShort(CHECK_INTERVAL_MS);

// Lista de serviços vem da env SERVICES (separados por vírgula). Estes são apenas exemplos.
const DEFAULT_SERVICES = [
  'example-api',
  'example-worker'
];

const envServices = process.env.SERVICES
  ? process.env.SERVICES.split(',').map(s => s.trim()).filter(Boolean)
  : undefined;

const CONFIG = {
  // Loki
  lokiUrl: process.env.LOKI_URL,

  // Serviços monitorados (env override via comma-separated SERVICES)
  services: envServices && envServices.length >= 1 ? envServices : DEFAULT_SERVICES,

  // Ambiente e rótulos
  environment: process.env.ENVIRONMENT || process.env.NODE_ENV || 'dev',
  logLabelKey: process.env.LOG_LABEL_KEY || 'job', // ex.: 'service' ou 'job'
  logEnvLabelKey: process.env.LOG_ENV_LABEL_KEY || 'env', // ex.: 'env'
  includeEnvFilter: (process.env.INCLUDE_ENV_FILTER || 'false') === 'true',

  // Discord Webhook (global) e por serviço (JSON)
  discordWebhook: process.env.DISCORD_WEBHOOK_URL,
  discordServiceWebhooks: (() => {
    try {
      return process.env.DISCORD_SERVICE_WEBHOOKS ? JSON.parse(process.env.DISCORD_SERVICE_WEBHOOKS) : {};
    } catch (_) {
      console.warn('DISCORD_SERVICE_WEBHOOKS inválido. Esperado JSON.');
      return {};
    }
  })(),

  // Email via API externa
  messagingApiUrl: process.env.MESSAGING_API_URL,
  emailRecipients: (process.env.EMAIL_TO || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean),
  emailFrom: process.env.EMAIL_FROM,

  // Grafana (para links diretos)
  grafanaUrl: process.env.GRAFANA_URL,

  // Intervalo de verificação
  checkInterval: CHECK_INTERVAL_MS,
  periodLongLabel: PERIOD_LONG_LABEL,
  periodShortLabel: PERIOD_SHORT_LABEL,

  // Modo de consulta ao Loki: 'pino_extended' (default) ou 'msg_only'
  queryMode: (process.env.LOKI_QUERY_MODE || 'pino_extended').toLowerCase(),

  // Concurrency de checagens para evitar 429
  maxConcurrentChecks: (() => {
    const n = parseInt(process.env.MAX_CONCURRENT_CHECKS || '1', 10);
    return Number.isNaN(n) || n < 1 ? 1 : n;
  })(),

  // Debug: logar queries e janelas de tempo
  debugLogql: (process.env.DEBUG_LOGQL || 'false') === 'true',

  // Níveis de severidade e palavras-chave de erro (configuráveis via env ERROR_KEYWORDS)
  errorKeywords: (() => {
    const envKw = process.env.ERROR_KEYWORDS
      ? process.env.ERROR_KEYWORDS.split(',').map(k => k.trim()).filter(Boolean)
      : null;
    const defaults = ['error', 'exception', 'fatal', 'critical', 'panic', 'erro', 'failed', 'fail'];
    return envKw && envKw.length > 0 ? envKw : defaults;
  })(),
  warningKeywords: ['warn', 'warning', 'deprecated']
};

// ==================== CLASSES ====================
class LokiClient {
  constructor(url) {
    this.url = url;
  }

  async queryLogs(query, start, end) {
    // Retry com backoff exponencial para 429/503
    const maxAttempts = 4;
    let attempt = 0;
    while (attempt < maxAttempts) {
      try {
        const response = await axios.get(`${this.url}/loki/api/v1/query_range`, {
          params: {
            query,
            // Loki aceita RFC3339 ou epoch ns. Para evitar 400 por parsing, usamos epoch ns como string.
            start: String(start),
            end: String(end),
            direction: 'backward',
            limit: 1000
          },
          timeout: 45000
        });

        return response.data?.data?.result ?? [];
      } catch (error) {
        const status = error?.response?.status;
        if (status === 429 || status === 503) {
          const retryAfter = parseInt(error?.response?.headers?.['retry-after'] || '0', 10);
          const base = retryAfter > 0 ? retryAfter * 1000 : 500 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * 250);
          const delay = base + jitter;
          console.warn(`Loki ${status} - tentando novamente em ${delay}ms (tentativa ${attempt + 1}/${maxAttempts})`);
          await new Promise(r => setTimeout(r, delay));
          attempt++;
          continue;
        }
        console.error('Erro ao consultar Loki:', error.message);
        return [];
      }
    }
    return [];
  }

  buildSelector(serviceName, labelKeyOverride = null, includeEnvFilter = null) {
    const selectors = [];
    const labelKey = labelKeyOverride || CONFIG.logLabelKey;
    selectors.push(`${labelKey}="${serviceName}"`);
    // Se includeEnvFilter é null, usa a configuração padrão; se false, ignora o filtro
    const shouldIncludeEnv = includeEnvFilter === null ? CONFIG.includeEnvFilter : includeEnvFilter;
    if (shouldIncludeEnv && CONFIG.logEnvLabelKey && CONFIG.environment) {
      selectors.push(`${CONFIG.logEnvLabelKey}="${CONFIG.environment}"`);
    }
    return `{${selectors.join(',')}}`;
  }

  buildLineRegexQuery(serviceName, regex) {
    const selectorStr = this.buildSelector(serviceName);
    return `${selectorStr} |~ "${regex}"`;
  }

  buildServiceQuery(serviceName, labelKeyOverride = null) {
    // Query LogQL com rótulo configurável (ex.: {job="service"}) e filtro de ambiente opcional
    const selectorStr = this.buildSelector(serviceName, labelKeyOverride);
    const escaped = CONFIG.errorKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = `(?i)(${escaped.join('|')})`;
    if (CONFIG.queryMode === 'msg_only') {
      // Query mais simples e equivalente ao que você testou no Grafana
      return `${selectorStr} | json | msg=~"${regex}"`;
    }
    // Default: suporte estendido para Pino (level>=40, level="error", msg/message/Message/err, fallback)
    // Inclui detecção de level como string "error" além de número >= 40
    // Inclui Message (maiúsculo) que é usado por alguns serviços .NET
    // Usa regex case-insensitive para buscar em qualquer campo do JSON
    return `${selectorStr} | json | (level >= 40) or (level="error") or (level=~"(?i)(error|fatal|critical)") or (msg=~"${regex}") or (message=~"${regex}") or (Message=~"${regex}") or (err=~"${regex}") or (Error=~"${regex}")`;
  }
}

class AlertManager {
  constructor(config) {
    this.config = config;
  }

  async sendDiscordAlert(errors) {
    const hasPerService = this.config.discordServiceWebhooks && Object.keys(this.config.discordServiceWebhooks).length > 0;

    if (hasPerService) {
      for (const error of errors) {
        const wh = this.config.discordServiceWebhooks[error.service];
        if (!wh) continue;
        try {
          const embed = this.buildDiscordEmbed([error]);
          await axios.post(wh, { username: '🚨 Monitor de Erros', embeds: [embed] }, { timeout: 10000 });
          console.log(`✅ Alerta enviado para Discord (serviço: ${error.service})`);
        } catch (err) {
          console.error(`❌ Erro ao enviar para Discord (serviço: ${error.service}):`, err.message);
        }
      }
    }

    if (this.config.discordWebhook) {
      try {
        const embed = this.buildDiscordEmbed(errors);
        await axios.post(this.config.discordWebhook, { username: '🚨 Monitor de Erros', embeds: [embed] }, { timeout: 10000 });
        console.log('✅ Alerta enviado para Discord (global)');
      } catch (error) {
        console.error('❌ Erro ao enviar para Discord (global):', error.message);
      }
    } else if (!hasPerService) {
      console.log('Discord webhook não configurado');
    }
  }

  buildDiscordEmbed(errors) {
    const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);
    const affectedServices = errors.length;

    const color = totalErrors > 50 ? 0xFF0000 : totalErrors > 10 ? 0xFFA500 : 0xFFFF00;

    const fields = errors.slice(0, 10).map(error => ({
      name: `🔴 ${error.service}`,
      value: `**${error.count} erros** nos últimos ${this.config.periodShortLabel}\n` +
             `Último erro: \`${(error.lastError || '').substring(0, 100)}...\`\n` +
             `[Abrir Grafana - Explore](<${error.grafanaLink}>)\n` +
             `Sugerido: abra Explore e rode \`${`{${this.config.logLabelKey}="${error.service}"}`}${this.config.includeEnvFilter && this.config.environment ? `, ${this.config.logEnvLabelKey}="${this.config.environment}"` : ''}\``,
      inline: false
    }));

    if (errors.length > 10) {
      fields.push({
        name: '⚠️ Mais serviços afetados',
        value: `+ ${errors.length - 10} serviços com erros`,
        inline: false
      });
    }

    return {
      title: '🚨 ALERTAS DE ERRO DETECTADOS',
      description: `**${totalErrors} erros** em **${affectedServices} serviços**\nPeríodo: últimos ${this.config.periodLongLabel}`,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Worker de Monitoramento'
      }
    };
  }

  async sendEmailAlert(errors) {
    if (!this.config.messagingApiUrl) {
      console.log('MESSAGING_API_URL não configurada; pulando envio de email');
      return;
    }

    const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);

    const metadata = {
      subject: `🚨 ${totalErrors} erros em ${errors.length} serviços (últimos ${this.config.periodShortLabel})`,
      template: `Monitoring Alerts - ${process.env.SYSTEM_NAME || 'Monitoring System'}`,
      totalErrors,
      affectedServices: errors.length,
      services: errors.map(e => ({
        service: e.service,
        count: e.count,
        lastError: (e.lastError || '').substring(0, 200),
        grafanaLink: e.grafanaLink
      }))
    };

    const res = await sendEmail({
      subjectCode: 'monitoring-alert',
      notificationType: 'Email',
      recipients: this.config.emailRecipients,
      metadata
    });

    if (res.success) {
      console.log('✅ Alerta enviado via API externa de mensagens');
    } else {
      console.error('❌ Falha ao enviar via API externa:', res.error);
    }
  }

  buildEmailHTML(errors) {
    const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);

    const rows = errors.map(error => `
      <tr>
        <td style="padding: 12px; border: 1px solid #ddd;">
          <strong>${error.service}</strong>
        </td>
        <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">
          <span style="color: #d32f2f; font-weight: bold;">${error.count}</span>
        </td>
        <td style="padding: 12px; border: 1px solid #ddd; font-size: 12px;">
          <code style="background: #f5f5f5; padding: 4px; display: block; overflow: hidden;">
            ${(error.lastError || '').substring(0, 150)}...
          </code>
        </td>
        <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">
          <a href="${error.grafanaLink}" style="background: #1976d2; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Ver Logs
          </a>
        </td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
          .header { background: #d32f2f; color: white; padding: 20px; border-radius: 4px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th { background: #f5f5f5; padding: 12px; text-align: left; border: 1px solid #ddd; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚨 Alertas de Erro - Worker de Monitoramento</h1>
            <p><strong>${totalErrors} erros</strong> detectados em <strong>${errors.length} serviços</strong></p>
            <p>Período: Últimos ${this.config.periodLongLabel}</p>
            <p>Timestamp: ${new Date().toLocaleString('pt-BR')}</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Serviço</th>
                <th>Nº Erros</th>
                <th>Último Erro</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>

          <div style="margin-top: 30px; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
            <strong>⚠️ Ação Recomendada:</strong>
            <ul>
              <li>Verificar os logs no Grafana usando os links acima</li>
              <li>Investigar serviços com maior número de erros primeiro</li>
              <li>Verificar se há padrões comuns entre os erros</li>
            </ul>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

// ==================== EMAIL VIA API EXTERNA ====================
export async function sendEmail(options) {
  try {
    const payload = {
      system: process.env.SYSTEM_NAME || 'Monitoring System',
      subjectCode: options.subjectCode,
      notificationType: options.notificationType || 'Email',
      recipients: options.recipients,
      metadata: options.metadata
    };

    const url = `${process.env.MESSAGING_API_URL}/api/message`;
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*'
      },
      timeout: 15000
    });

    return { success: true, data: response.data };
  } catch (error) {
    console.error(`❌ Erro ao enviar mensagem: ${error.message}`);
    return { success: false, error: error.message };
  }
}

class ErrorMonitor {
  constructor(config) {
    this.config = config;
    this.lokiClient = new LokiClient(config.lokiUrl);
    this.alertManager = new AlertManager(config);
  }

  async checkService(serviceName, startTime, endTime) {
    // Log sempre para gs1-integration-worker para debug
    const shouldDebug = this.config.debugLogql || serviceName === 'gs1-integration-worker';
    
    // Estratégia: buscar todos os logs primeiro e filtrar em memória
    // Isso garante que não perdemos logs por problemas na query LogQL
    
    // Primeiro tenta com o rótulo padrão (job), sem filtro de ambiente
    let plainQuery = this.lokiClient.buildSelector(serviceName, null, false);
    let results = await this.lokiClient.queryLogs(plainQuery, startTime, endTime);
    
    // Se não encontrou nada e o rótulo padrão é 'job', tenta com 'app' sem filtro de ambiente
    if ((!Array.isArray(results) || results.length === 0) && CONFIG.logLabelKey === 'job') {
      if (shouldDebug) {
        console.log(`🪵 [DEBUG] ${serviceName}: Nenhum resultado com rótulo 'job', tentando 'app'...`);
      }
      plainQuery = this.lokiClient.buildSelector(serviceName, 'app', false);
      results = await this.lokiClient.queryLogs(plainQuery, startTime, endTime);
    }
    
    // Se ainda não encontrou e o filtro de ambiente estava ativo, tenta sem filtro de ambiente
    if ((!Array.isArray(results) || results.length === 0) && CONFIG.includeEnvFilter) {
      if (shouldDebug) {
        console.log(`🪵 [DEBUG] ${serviceName}: Nenhum resultado com filtro de ambiente, tentando sem filtro...`);
      }
      // Tenta sem filtro de ambiente
      plainQuery = this.lokiClient.buildSelector(serviceName, CONFIG.logLabelKey, false);
      results = await this.lokiClient.queryLogs(plainQuery, startTime, endTime);
      
      // Se ainda não encontrou e o rótulo é 'job', tenta 'app' sem filtro
      if ((!Array.isArray(results) || results.length === 0) && CONFIG.logLabelKey === 'job') {
        plainQuery = this.lokiClient.buildSelector(serviceName, 'app', false);
        results = await this.lokiClient.queryLogs(plainQuery, startTime, endTime);
      }
    }

    if (shouldDebug) {
      const startIso = new Date(Math.floor(startTime / 1000000)).toISOString();
      const endIso = new Date(Math.floor(endTime / 1000000)).toISOString();
      console.log(`🪵 [DEBUG] Service: ${serviceName}`);
      console.log(`🪵 [DEBUG] Query: ${plainQuery}`);
      console.log(`🪵 [DEBUG] Range: ${startIso} -> ${endIso}`);
      console.log(`🪵 [DEBUG] Results: ${Array.isArray(results) ? results.length : 0} streams`);
      if (CONFIG.includeEnvFilter) {
        console.log(`🪵 [DEBUG] Filtro de ambiente estava ATIVO: ${CONFIG.logEnvLabelKey}="${CONFIG.environment}"`);
        console.log(`🪵 [DEBUG] ⚠️ Se não encontrou logs, pode ser que os logs tenham env diferente (ex: "Production" vs "dev")`);
      } else {
        console.log(`🪵 [DEBUG] Filtro de ambiente DESATIVADO`);
      }
    }

    if (!Array.isArray(results) || results.length === 0) {
      if (this.config.debugLogql) {
        console.log(`🪵 [DEBUG] ${serviceName}: Nenhum resultado retornado do Loki`);
      }
      return null;
    }

    // Conta total de logs antes do filtro
    let totalLogs = 0;
    results.forEach(result => {
      totalLogs += result.values?.length || 0;
    });
    
    if (shouldDebug) {
      console.log(`🪵 [DEBUG] ${serviceName}: ${totalLogs} logs encontrados antes do filtro`);
    }

    const errors = [];
    const keywords = this.config.errorKeywords.map(k => k.toLowerCase());
    results.forEach(result => {
      result.values?.forEach(([timestamp, log]) => {
        const tsMs = parseInt(timestamp, 10) / 1000000;
        const lower = (log || '').toLowerCase();
        let matches = keywords.some(k => lower.includes(k));
        if (!matches) {
          try {
            const obj = JSON.parse(log);
            // Busca em todos os campos do JSON (case-insensitive)
            const concatenated = JSON.stringify(obj).toLowerCase();
            matches = keywords.some(k => concatenated.includes(k));
            
            // Verifica campos específicos que podem conter mensagens de erro
            const messageFields = ['msg', 'message', 'Message', 'error', 'Error', 'err', 'Err'];
            if (!matches) {
              for (const field of messageFields) {
                const fieldValue = obj[field];
                if (fieldValue && typeof fieldValue === 'string') {
                  const fieldLower = fieldValue.toLowerCase();
                  if (keywords.some(k => fieldLower.includes(k))) {
                    matches = true;
                    break;
                  }
                }
              }
            }
            
            // Verifica level ANTES de outras verificações - level é mais confiável
            const lvl = obj.level;
            // Se level é string "error", "fatal", "critical", etc., é erro (prioridade alta)
            if (typeof lvl === 'string') {
              const lvlLower = lvl.toLowerCase();
              if (lvlLower === 'error' || ['fatal', 'critical', 'panic'].includes(lvlLower)) {
                matches = true;
              } else if (!matches) {
                matches = keywords.some(k => lvlLower.includes(k));
              }
            }
            // Se level é número >= 40 (Pino: 40=warn, 50=error, 60=fatal), é erro
            if (!matches && typeof lvl === 'number' && lvl >= 40) {
              matches = true;
            }
          } catch (_) {
            // não é JSON; manter resultado do includes simples
          }
        }
        if (matches) {
          errors.push({ timestamp: tsMs, log });
        }
      });
    });

    if (shouldDebug) {
      console.log(`🪵 [DEBUG] ${serviceName}: ${errors.length} erros detectados após filtro`);
      if (totalLogs > 0 && errors.length === 0) {
        // Se encontrou logs mas não detectou erros, mostra um exemplo
        try {
          const firstResult = results[0];
          if (firstResult?.values?.length > 0) {
            const sampleLog = firstResult.values[0][1];
            console.log(`🪵 [DEBUG] ${serviceName}: Exemplo de log (não detectado como erro):`);
            console.log(`🪵 [DEBUG] ${serviceName}: ${sampleLog.substring(0, 200)}...`);
            try {
              const sampleObj = JSON.parse(sampleLog);
              console.log(`🪵 [DEBUG] ${serviceName}: level=${sampleObj.level}, Message=${sampleObj.Message?.substring(0, 50)}...`);
            } catch (_) {}
          }
        } catch (_) {}
      }
      if (errors.length > 0 && errors.length <= 3) {
        errors.forEach((err, idx) => {
          console.log(`🪵 [DEBUG] ${serviceName} - Erro ${idx + 1}: ${err.log.substring(0, 150)}...`);
        });
      }
    }

    if (errors.length === 0) {
      return null;
    }

    errors.sort((a, b) => b.timestamp - a.timestamp);

    const grafanaLink = this.buildGrafanaLink(serviceName, startTime, endTime);

    return {
      service: serviceName,
      count: errors.length,
      lastError: errors[0].log,
      firstError: errors[errors.length - 1].log,
      grafanaLink,
      errors: errors.slice(0, 5)
    };
  }

  buildGrafanaLink(serviceName, startTime, endTime) {
    // Link base para Explore (o usuário rodará a query manualmente)
    return `${this.config.grafanaUrl}/explore`;
  }

  async runCheck() {
    console.log('\n' + '='.repeat(80));
    console.log(`🔍 Iniciando verificação: ${new Date().toLocaleString('pt-BR')}`);
    console.log('='.repeat(80));
    console.log(`📋 Serviços monitorados: ${this.config.services.length}`);
    if (this.config.debugLogql) {
      console.log(`📋 Lista: ${this.config.services.join(', ')}`);
    }

    const endTime = Date.now() * 1000000; // ns
    const startTime = endTime - (this.config.checkInterval * 1000000);

    const services = this.config.services;
    const concurrency = this.config.maxConcurrentChecks;
    const results = new Array(services.length);
    let currentIndex = 0;

    const worker = async (workerId) => {
      while (true) {
        const index = currentIndex++;
        if (index >= services.length) break;
        const service = services[index];
        try {
          results[index] = await this.checkService(service, startTime, endTime);
        } catch (err) {
          console.error(`❌ Erro ao checar serviço ${service}:`, err?.message || err);
          results[index] = null;
        }
      }
    };

    const poolSize = Math.min(concurrency, services.length);
    const pool = Array.from({ length: poolSize }, (_, i) => worker(i));
    await Promise.all(pool);
    const errorsFound = results.filter(r => r !== null);

    if (errorsFound.length === 0) {
      console.log(`✅ Nenhum erro detectado nos últimos ${this.config.periodLongLabel}`);
      return;
    }

    console.log(`\n🚨 ${errorsFound.length} serviços com erros detectados:\n`);
    errorsFound.forEach(error => {
      console.log(`   🔴 ${error.service}: ${error.count} erros`);
    });

    await Promise.all([
      this.alertManager.sendDiscordAlert(errorsFound),
      this.alertManager.sendEmailAlert(errorsFound)
    ]);

    console.log('\n✅ Verificação concluída');
  }

  start() {
    console.log('🚀 Worker de Monitoramento iniciado');
    console.log(`📊 Monitorando ${this.config.services.length} serviços`);
    console.log(`⏱️  Intervalo: ${this.config.periodLongLabel}`);
    console.log(`🔗 Loki: ${this.config.lokiUrl}`);
    console.log(`🔗 Grafana: ${this.config.grafanaUrl}\n`);

    // Executar imediatamente
    this.runCheck();

    // Agendar execução a cada 15 minutos
    cron.schedule('*/15 * * * *', () => {
      this.runCheck();
    });
  }
}

// ==================== EXECUÇÃO ====================
const monitor = new ErrorMonitor(CONFIG);
monitor.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 Encerrando worker...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 Encerrando worker...');
  process.exit(0);
});


