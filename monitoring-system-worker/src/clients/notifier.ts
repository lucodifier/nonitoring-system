import axios from 'axios';
import * as dotenv from 'dotenv';
import { log } from '../logger';

dotenv.config({ quiet: true });

/**
 * Envio de alerta para webhook de chat.
 *
 * Discord e Google Chat NAO compartilham formato de payload: o Discord usa
 * { content, username, embeds[] }, e o Google Chat rejeita `embeds` com
 * 400 "Invalid JSON payload received. Unknown name". Trocar só a URL na variável
 * de ambiente faria todo alerta falhar em silêncio (o erro só apareceria no log
 * do worker, que roda com LOG_LEVEL=error).
 *
 * Por isso o provider é detectado pela URL e o payload é montado de acordo.
 */

export type WebhookKind = 'discord' | 'googlechat';

export interface AlertPayload {
  severity: string;
  title: string;
  message: string;
  serviceName: string;
  serviceType: string;
  env: string;
  timestamp: string;
  serviceLink?: string;
  logsLink?: string;
  /**
   * Linhas extras de contexto ("Uso atual: 91,2%", "Projecao: enche em ~18 horas").
   * Opcional para nao mexer em nenhum chamador existente.
   */
  details?: string[];
}

const DISCORD_COLOR_CRITICAL = 15158332; // vermelho
const DISCORD_COLOR_WARNING = 16776960; // amarelo
const DISCORD_COLOR_RESOLVED = 3066993; // verde

/** Mensagem de normalização usa severity 'resolved' e precisa ler como boa notícia. */
const isResolved = (severity: string) => severity === 'resolved';

export const getWebhookUrl = (): string | undefined =>
  process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;

/**
 * Detecta o destino pela URL. ALERT_WEBHOOK_KIND força manualmente, se necessário.
 * Default é 'discord' para não mudar o comportamento de quem já usa Discord.
 */
export const detectWebhookKind = (url: string): WebhookKind => {
  const forced = (process.env.ALERT_WEBHOOK_KIND || '').toLowerCase();
  if (forced === 'discord' || forced === 'googlechat') return forced;

  if (url.includes('chat.googleapis.com')) return 'googlechat';
  return 'discord';
};

const buildDiscordBody = (p: AlertPayload) => ({
  content: `${isResolved(p.severity) ? '✅' : '🚨'} **${p.severity.toUpperCase()}**: ${p.title}\n\n${p.message}`,
  username: 'Monitoring Bot',
  embeds: [
    {
      title: p.title,
      description: p.message,
      color: isResolved(p.severity)
        ? DISCORD_COLOR_RESOLVED
        : p.severity === 'critical'
          ? DISCORD_COLOR_CRITICAL
          : DISCORD_COLOR_WARNING,
      fields: [
        { name: 'Service', value: p.serviceName, inline: true },
        { name: 'Type', value: p.serviceType, inline: true },
        { name: 'Environment', value: p.env, inline: true },
        ...(p.details?.length
          ? [{ name: 'Detalhes', value: p.details.join('\n'), inline: false }]
          : []),
      ],
      timestamp: p.timestamp,
      footer: { text: 'Monitoring System' },
      ...(p.serviceLink ? { url: p.serviceLink } : {}),
    },
    ...(p.logsLink
      ? [
          {
            title: 'View Logs in Dashboard',
            url: p.logsLink,
            description: `Click to analyze logs for ${p.serviceName}`,
            color: 3447003,
          },
        ]
      : []),
  ],
});

/**
 * Google Chat aceita markdown limitado no campo `text`: *negrito*, _italico_, `code`.
 * Nada de ** como no Discord -- dois asteriscos aparecem literalmente na mensagem.
 */
const buildGoogleChatBody = (p: AlertPayload) => {
  const icon = isResolved(p.severity) ? '🟢' : p.severity === 'critical' ? '🔴' : '🟡';
  const links = [
    p.serviceLink ? `<${p.serviceLink}|Ver serviço>` : null,
    p.logsLink ? `<${p.logsLink}|Ver logs>` : null,
  ]
    .filter(Boolean)
    .join('  •  ');

  const lines = [
    `${icon} *${p.severity.toUpperCase()}* — ${p.title}`,
    '',
    p.message,
    ...(p.details?.length ? ['', ...p.details.map((d) => `• ${d}`)] : []),
    '',
    `*Serviço:* ${p.serviceName}  |  *Tipo:* ${p.serviceType}  |  *Ambiente:* ${p.env}`,
    links || null,
  ].filter((l) => l !== null);

  return { text: lines.join('\n') };
};

/**
 * Envia o alerta. Nunca lança: falha de webhook não pode derrubar o ciclo do worker.
 * Retorna true se o envio foi aceito, para o chamador decidir se marca como notificado.
 */
export const sendAlertNotification = async (payload: AlertPayload): Promise<boolean> => {
  const webhookUrl = getWebhookUrl();

  if (!webhookUrl) {
    log.warn('ALERT_WEBHOOK_URL/DISCORD_WEBHOOK_URL não configurado – alerta não enviado.');
    return false;
  }

  const kind = detectWebhookKind(webhookUrl);
  const body = kind === 'googlechat' ? buildGoogleChatBody(payload) : buildDiscordBody(payload);

  try {
    await axios.post(webhookUrl, body, { timeout: 10000 });
    log.info(`Alerta enviado (${kind}): ${payload.title}`);
    return true;
  } catch (error: any) {
    log.error(`Falha ao enviar alerta (${kind}): ${error.message}`);
    if (error.response?.data) {
      log.error(`Resposta do webhook: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
};
