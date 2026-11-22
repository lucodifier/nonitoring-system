import { IsNull, Repository } from 'typeorm';
import { Vm } from '../entities/Vm';
import { VmAlert, VmAlertType } from '../entities/VmAlert';
import { sendAlertNotification, getWebhookUrl } from '../clients/notifier';
import { vmConfig } from '../config/vm-config';
import { log } from '../logger';

export interface RaiseAlertInput {
  vm: Vm;
  type: VmAlertType;
  severity: 'critical' | 'warning';
  /** Título curto da mensagem (ex: "VM app-01 está pausada"). */
  title: string;
  /** Corpo do alerta. */
  message: string;
  /** Linhas extras: valor atual, projeção, etc. */
  details?: string[];
  /** Chave secundária: o mount, nos alertas de disco. Sem escopo, use null. */
  scope?: string | null;
  currentValue?: number | null;
  metadata?: Record<string, unknown>;
}

const scopeMatch = (scope: string | null | undefined) =>
  scope === null || scope === undefined ? IsNull() : scope;

/**
 * Procura o alerta aberto (resolved_at IS NULL) daquela VM/tipo/escopo.
 * É a base tanto do anti-spam quanto da resolução.
 */
async function findOpenAlert(
  repo: Repository<VmAlert>,
  vmId: string,
  type: VmAlertType,
  scope: string | null | undefined,
): Promise<VmAlert | null> {
  return repo.findOne({
    where: {
      vmId,
      type,
      scope: scopeMatch(scope) as any,
      resolvedAt: IsNull(),
    },
    order: { createdAt: 'DESC' },
  });
}

/**
 * Abre (ou atualiza) um alerta e notifica no Google Chat.
 *
 * Anti-spam: não reenvia o mesmo alerta da mesma VM antes de
 * VM_ALERT_COOLDOWN_MINUTES. O cooldown é medido por `notified_at` NO BANCO, e não
 * por um Map em memória como no worker de serviços: o container reinicia a cada
 * deploy, e com estado em memória o cooldown zerava junto -- um deploy no meio de
 * uma janela ruim reenviaria tudo.
 */
export async function raiseAlert(
  repo: Repository<VmAlert>,
  input: RaiseAlertInput,
): Promise<void> {
  const { vm, type, severity, title, message, details, currentValue, metadata } = input;
  const scope = input.scope ?? null;

  const existing = await findOpenAlert(repo, vm.id, type, scope);
  const now = new Date();
  const cooldownMs = vmConfig.alerts.cooldownMinutes * 60 * 1000;

  let alert: VmAlert;

  if (existing) {
    // Alerta continua valendo: atualiza os números para o dashboard mostrar o estado
    // corrente, mas o envio ainda passa pelo cooldown abaixo.
    existing.message = message;
    existing.severity = severity;
    existing.currentValue = currentValue ?? null;
    existing.metadata = { ...(existing.metadata || {}), ...(metadata || {}), title };
    alert = await repo.save(existing);

    const lastNotified = existing.notifiedAt ? existing.notifiedAt.getTime() : 0;
    if (now.getTime() - lastNotified < cooldownMs) {
      log.info(
        `[VM][Alert] Em cooldown, não reenviado: ${vm.hostname}/${type}${scope ? `/${scope}` : ''}`,
      );
      return;
    }
  } else {
    const created = new VmAlert();
    created.vmId = vm.id;
    created.type = type;
    created.severity = severity;
    created.message = message;
    created.scope = scope;
    created.currentValue = currentValue ?? null;
    created.metadata = { ...(metadata || {}), title };
    // Explícito: a coluna created_at em prod não tem DEFAULT (ver VmStatusHistory).
    created.createdAt = new Date();
    alert = await repo.save(created);
    log.warn(`[VM][Alert] Novo alerta: ${vm.hostname} type=${type}${scope ? ` scope=${scope}` : ''}`);
  }

  const sent = await notify({
    severity,
    title,
    message,
    details,
    vm,
    timestamp: (alert.createdAt || now).toISOString(),
  });

  if (sent) {
    alert.notifiedAt = now;
    await repo.save(alert);
  }
}

/**
 * Fecha o alerta aberto daquela VM/tipo/escopo, se existir, e avisa que normalizou.
 * No-op silencioso quando não havia alerta aberto -- assim o ciclo pode chamar
 * resolveAlert() sempre que enxergar a VM saudável, sem checar antes.
 */
export async function resolveAlert(
  repo: Repository<VmAlert>,
  vm: Vm,
  type: VmAlertType,
  scope: string | null | undefined,
  resolutionMessage: string,
  details?: string[],
): Promise<void> {
  const open = await findOpenAlert(repo, vm.id, type, scope ?? null);
  if (!open) return;

  open.resolvedAt = new Date();
  // Marca a entrega da resolucao como pendente ANTES de tentar enviar.
  //
  // Resolver e notificar sao estados separados de proposito: o alerta precisa
  // fechar (senao o proximo ciclo nao reabre nada e o cooldown trava), mas se o
  // webhook estiver fora do ar na hora, a mensagem de "voltou ao normal" se
  // perderia para sempre -- e quem esta de plantao continuaria achando que a VM
  // esta com problema. A flag deixa o proximo ciclo reenviar.
  open.metadata = { ...(open.metadata || {}), resolutionPending: true, resolutionMessage, resolutionDetails: details || [] };
  await repo.save(open);

  log.warn(
    `[VM][Alert] Resolvido: ${vm.hostname} type=${type}${scope ? ` scope=${scope}` : ''}`,
  );

  const sent = await notify({
    severity: 'resolved',
    title: `Normalizado: ${vm.name || vm.hostname}`,
    message: resolutionMessage,
    details,
    vm,
    timestamp: open.resolvedAt.toISOString(),
  });

  if (sent) {
    await clearResolutionPending(repo, open);
  }
}

/**
 * Reenvia as mensagens de resolucao que ficaram pendentes por falha de webhook.
 *
 * Chamado uma vez por VM por ciclo. No caminho feliz a consulta nao acha nada e
 * custa um index scan -- a coluna resolved_at ja e' indexada pelo indice parcial
 * dos alertas abertos, e este filtro e' o complemento dele.
 */
export async function retryPendingResolutions(
  repo: Repository<VmAlert>,
  vm: Vm,
): Promise<void> {
  const pendentes = await repo
    .createQueryBuilder('a')
    .where('a.vm_id = :vmId', { vmId: vm.id })
    .andWhere('a.resolved_at IS NOT NULL')
    .andWhere(`a.metadata ->> 'resolutionPending' = 'true'`)
    .orderBy('a.resolved_at', 'ASC')
    .limit(20)
    .getMany();

  for (const alert of pendentes) {
    const meta = (alert.metadata || {}) as any;
    const sent = await notify({
      severity: 'resolved',
      title: `Normalizado: ${vm.name || vm.hostname}`,
      message: meta.resolutionMessage || `${vm.name || vm.hostname}: situação normalizada.`,
      details: Array.isArray(meta.resolutionDetails) ? meta.resolutionDetails : undefined,
      vm,
      timestamp: (alert.resolvedAt || new Date()).toISOString(),
    });

    if (!sent) return; // webhook ainda fora: nao adianta insistir nos demais agora
    await clearResolutionPending(repo, alert);
    log.warn(`[VM][Alert] Resolucao pendente reenviada: ${vm.hostname} type=${alert.type}`);
  }
}

async function clearResolutionPending(repo: Repository<VmAlert>, alert: VmAlert): Promise<void> {
  const meta = { ...((alert.metadata || {}) as any) };
  delete meta.resolutionPending;
  delete meta.resolutionMessage;
  delete meta.resolutionDetails;
  alert.metadata = meta;
  await repo.save(alert);
}

/**
 * Manda para o webhook de chat já existente (notifier.ts), que detecta Google Chat
 * pela URL. Nenhum webhook novo: o mesmo ALERT_WEBHOOK_URL dos alertas de serviço.
 */
async function notify(args: {
  severity: string;
  title: string;
  message: string;
  details?: string[];
  vm: Vm;
  timestamp: string;
}): Promise<boolean> {
  if (!getWebhookUrl()) {
    log.warn('[VM][Alert] ALERT_WEBHOOK_URL/DISCORD_WEBHOOK_URL não configurado – nada enviado.');
    return false;
  }

  const { vm } = args;
  const identity = [
    vm.ip ? `IP ${vm.ip}` : null,
    vm.providerId ? `ID no hypervisor: ${vm.providerId}` : null,
  ].filter(Boolean) as string[];

  return sendAlertNotification({
    severity: args.severity,
    title: args.title,
    message: args.message,
    details: [...(args.details || []), ...identity],
    serviceName: vm.name || vm.hostname,
    serviceType: 'vm',
    env: process.env.NODE_ENV || 'production',
    timestamp: args.timestamp,
    // Sem serviceLink: o dashboard ainda não tem tela de VM, e link que dá 404
    // dentro do alerta atrapalha mais do que ajuda. Quando a tela existir, aponte
    // para ela aqui.
  });
}
