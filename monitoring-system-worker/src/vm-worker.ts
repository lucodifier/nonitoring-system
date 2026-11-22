import { Repository } from 'typeorm';
import { AppDataSource } from './data-source';
import { Vm } from './entities/Vm';
import { VmAlert } from './entities/VmAlert';
import { VmStatusHistory } from './entities/VmStatusHistory';
import { DiskSnapshot } from './entities/DiskSnapshot';
import { getVmProvider, VmState } from './clients/vm-provider';
import { checkVmReachable } from './clients/vm-reachability';
import { forecastDisk, evaluateDisk, formatHorizon, DiskSample } from './services/disk-forecast';
import { raiseAlert, resolveAlert, retryPendingResolutions } from './services/vm-alerts';
import { vmConfig } from './config/vm-config';
import { log } from './logger';

/**
 * Ciclo de monitoramento de VMs (default: a cada 2 minutos).
 *
 * Para cada VM habilitada, em ordem:
 *   1. estado no hypervisor (se houver provider) -> alerta de parada/pausa
 *   2. ping/TCP quando o hypervisor não sabe dizer -> alerta de inacessível
 *   3. idade do último heartbeat -> alerta de heartbeat ausente
 *   4. projeção de disco sobre disk_snapshots -> alerta amarelo/vermelho
 *
 * Nunca lança: erro de uma VM não pode impedir a checagem das outras nem derrubar
 * o processo, que também roda o ciclo de serviços.
 */
export const processVms = async (): Promise<void> => {
  if (!vmConfig.enabled) {
    log.debug('[VM] VM_MONITORING_ENABLED != true — ciclo de VMs ignorado.');
    return;
  }

  console.warn(`[VM] Cycle started at ${new Date().toISOString()}`);

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const vmRepo = AppDataSource.getRepository(Vm);
  const alertRepo = AppDataSource.getRepository(VmAlert);
  const historyRepo = AppDataSource.getRepository(VmStatusHistory);
  const snapshotRepo = AppDataSource.getRepository(DiskSnapshot);

  const vms = await vmRepo.find({ where: { enabled: true }, order: { hostname: 'ASC' } });

  if (vms.length === 0) {
    log.info('[VM] Nenhuma VM habilitada em monitoring.vms.');
    return;
  }

  // Uma consulta ao hypervisor por ciclo, não uma por VM.
  const provider = await getVmProvider();
  let providerStates: VmState[] = [];
  try {
    providerStates = await provider.listVms();
    log.info(`[VM] Provider ${provider.name} retornou ${providerStates.length} VM(s).`);
  } catch (err: any) {
    log.error(`[VM] Falha ao listar VMs no provider ${provider.name}: ${err.message}`);
  }

  const byProviderId = new Map(providerStates.map((s) => [String(s.providerId), s]));
  const byName = new Map(providerStates.filter((s) => s.name).map((s) => [s.name.toLowerCase(), s]));

  for (const vm of vms) {
    try {
      await processVm(vm, { vmRepo, alertRepo, historyRepo, snapshotRepo }, byProviderId, byName, provider.name);
    } catch (err: any) {
      log.error(`[VM] Erro ao processar ${vm.hostname}: ${err.message}`);
      if (err.stack) log.debug(err.stack);
    }
  }

  log.info(`[VM] Ciclo concluído (${vms.length} VM(s)).`);
};

interface Repos {
  vmRepo: Repository<Vm>;
  alertRepo: Repository<VmAlert>;
  historyRepo: Repository<VmStatusHistory>;
  snapshotRepo: Repository<DiskSnapshot>;
}

async function processVm(
  vm: Vm,
  repos: Repos,
  byProviderId: Map<string, VmState>,
  byName: Map<string, VmState>,
  providerName: string,
): Promise<void> {
  // Casa por provider_id; se a VM não tem esse campo preenchido, tenta pelo nome
  // que o hypervisor reporta. Cadastrar o provider_id continua sendo o caminho
  // confiável -- nome muda e colide.
  const state =
    (vm.providerId ? byProviderId.get(String(vm.providerId)) : undefined) ||
    byName.get((vm.name || vm.hostname).toLowerCase());

  const hypervisorKnows = !!state && state.status !== 'unknown';

  if (hypervisorKnows) {
    await handleHypervisorState(vm, state, repos, providerName);
  } else {
    if (providerName !== 'none') {
      log.debug(`[VM] ${vm.hostname}: sem estado no provider ${providerName} — caindo para ping/TCP.`);
    }
    await handleReachability(vm, repos);
  }

  await handleHeartbeat(vm, repos);
  await handleDisk(vm, repos);

  // Mensagens de "voltou ao normal" que nao sairam por falha de webhook.
  await retryPendingResolutions(repos.alertRepo, vm);
}

/** Estado vindo do hypervisor: a fonte mais confiável quando existe. */
async function handleHypervisorState(
  vm: Vm,
  state: VmState,
  repos: Repos,
  providerName: string,
): Promise<void> {
  await recordStatus(repos.historyRepo, vm, state.status, providerName);

  const label = vm.name || vm.hostname;

  if (state.status === 'running') {
    // A VM voltou pelo hypervisor: o contador de sondagem também zera, senão uma
    // VM que ficou parada carregaria falhas antigas para o próximo ciclo.
    await clearProbeFailures(repos.vmRepo, vm);
    await resolveAlert(repos.alertRepo, vm, 'down', null, `${label} voltou a rodar (${providerName}).`);
    await resolveAlert(repos.alertRepo, vm, 'paused', null, `${label} saiu do estado pausado.`);
    return;
  }

  if (state.status === 'paused') {
    await resolveAlert(repos.alertRepo, vm, 'down', null, `${label} não está mais parada (agora: pausada).`);
    await raiseAlert(repos.alertRepo, {
      vm,
      type: 'paused',
      severity: 'warning',
      title: `VM pausada: ${label}`,
      message: `A VM ${label} está com estado *${state.status}* no hypervisor (esperado: running).`,
      details: [
        `Estado atual: ${state.status}`,
        `Fonte: ${providerName}`,
        ...(state.raw ? [`Leitura: ${state.raw}`] : []),
      ],
      metadata: { providerStatus: state.status, provider: providerName },
    });
    return;
  }

  // stopped
  await resolveAlert(repos.alertRepo, vm, 'paused', null, `${label} não está mais pausada (agora: parada).`);
  await raiseAlert(repos.alertRepo, {
    vm,
    type: 'down',
    severity: 'critical',
    title: `VM parada: ${label}`,
    message: `A VM ${label} está com estado *${state.status}* no hypervisor (esperado: running).`,
    details: [
      `Estado atual: ${state.status}`,
      `Fonte: ${providerName}`,
      ...(state.raw ? [`Leitura: ${state.raw}`] : []),
    ],
    metadata: { providerStatus: state.status, provider: providerName },
  });
}

/**
 * Fallback sem acesso de gerenciamento ao guest: ping/TCP nos IPs cadastrados.
 *
 * Exige VM_UNREACHABLE_FAILURES falhas consecutivas antes de alertar -- uma perda
 * de pacote isolada não é queda, e alertar na primeira falha transformaria o canal
 * em ruído. O contador vive no banco para sobreviver a restart do worker.
 */
async function handleReachability(vm: Vm, repos: Repos): Promise<void> {
  if (!vm.ip) {
    log.debug(`[VM] ${vm.hostname}: sem IP cadastrado — sonda de rede ignorada.`);
    return;
  }

  const result = await checkVmReachable(vm.ip);
  const label = vm.name || vm.hostname;

  // method 'none' = nao houve sonda (IP ausente ou malformado no cadastro).
  // Isso e' erro de configuracao, nao queda: contar como falha faria um erro de
  // digitacao em vms.ip virar alerta de "VM inacessivel", mandando alguem cacar
  // uma maquina que esta perfeitamente bem. Fica no log, para quem cadastrou ver.
  if (result.method === 'none') {
    log.error(`[VM] ${vm.hostname}: sonda nao executada (${result.detail}). Corrija monitoring.vms.ip.`);
    return;
  }

  if (result.reachable) {
    await recordStatus(repos.historyRepo, vm, 'running', `probe:${result.method}`);
    await clearProbeFailures(repos.vmRepo, vm);
    await resolveAlert(
      repos.alertRepo,
      vm,
      'down',
      null,
      `${label} voltou a responder (${result.detail}).`,
    );
    return;
  }

  await recordStatus(repos.historyRepo, vm, 'unreachable', `probe:${result.method}`);

  const failures = (vm.consecutiveProbeFailures || 0) + 1;
  vm.consecutiveProbeFailures = failures;
  await repos.vmRepo.update({ id: vm.id }, { consecutiveProbeFailures: failures });

  const threshold = vmConfig.probe.failuresToAlert;
  if (failures < threshold) {
    log.info(`[VM] ${vm.hostname} inacessível (${failures}/${threshold}) — ainda sem alerta.`);
    return;
  }

  await raiseAlert(repos.alertRepo, {
    vm,
    type: 'down',
    severity: 'critical',
    title: `VM inacessível: ${label}`,
    message: `A VM ${label} (${vm.ip}) não responde há ${failures} verificações consecutivas.`,
    details: [`Falhas consecutivas: ${failures}`, `Detalhe da sonda: ${result.detail}`],
    currentValue: failures,
    metadata: { probeMethod: result.method, consecutiveFailures: failures },
  });
}

/**
 * Heartbeat ausente: detecta queda mesmo sem hypervisor e sem ping (VM viva mas
 * travada, ou rede de gerência sem rota até ela).
 *
 * VM que nunca enviou heartbeat não alerta: seria um alerta permanente para toda
 * VM cadastrada antes de o agente ser instalado.
 */
async function handleHeartbeat(vm: Vm, repos: Repos): Promise<void> {
  const label = vm.name || vm.hostname;
  const maxAgeMs = vmConfig.heartbeat.maxAgeMinutes * 60 * 1000;

  if (!vm.lastHeartbeatAt) {
    log.debug(`[VM] ${vm.hostname}: nunca enviou heartbeat — alerta no_heartbeat não se aplica.`);
    return;
  }

  const ageMs = Date.now() - vm.lastHeartbeatAt.getTime();
  const ageMinutes = ageMs / 60000;

  if (ageMs <= maxAgeMs) {
    await resolveAlert(
      repos.alertRepo,
      vm,
      'no_heartbeat',
      null,
      `${label} voltou a enviar heartbeat.`,
    );
    return;
  }

  await raiseAlert(repos.alertRepo, {
    vm,
    type: 'no_heartbeat',
    severity: 'critical',
    title: `Sem heartbeat: ${label}`,
    message: `A VM ${label} não envia heartbeat há ${Math.round(ageMinutes)} minutos (limite: ${vmConfig.heartbeat.maxAgeMinutes} min).`,
    details: [
      `Último heartbeat: ${vm.lastHeartbeatAt.toISOString()}`,
      `Silêncio: ${Math.round(ageMinutes)} minutos`,
    ],
    currentValue: ageMinutes,
    metadata: { lastHeartbeatAt: vm.lastHeartbeatAt.toISOString(), ageMinutes },
  });
}

/**
 * Avalia cada mount com dados na janela de tendência: percentual atual + projeção
 * linear de enchimento.
 *
 * Amarelo e vermelho são tipos de alerta distintos (disk_warning/disk_critical),
 * então a escalada de amarelo para vermelho fecha o amarelo e abre o vermelho --
 * sem isso o cooldown do amarelo seguraria o vermelho por até 30 minutos.
 */
async function handleDisk(vm: Vm, repos: Repos): Promise<void> {
  const windowStart = new Date(Date.now() - vmConfig.disk.trendWindowDays * 24 * 60 * 60 * 1000);

  const rows: Array<{ mount: string; total_gb: number; used_gb: number; collected_at: Date }> =
    await repos.snapshotRepo
      .createQueryBuilder('s')
      .select(['s.mount AS mount', 's.total_gb AS total_gb', 's.used_gb AS used_gb', 's.collected_at AS collected_at'])
      .where('s.vm_id = :vmId', { vmId: vm.id })
      .andWhere('s.collected_at >= :windowStart', { windowStart })
      .orderBy('s.mount', 'ASC')
      .addOrderBy('s.collected_at', 'ASC')
      .getRawMany();

  if (rows.length === 0) {
    log.debug(`[VM] ${vm.hostname}: sem disk_snapshots na janela — nada a projetar.`);
    return;
  }

  const byMount = new Map<string, DiskSample[]>();
  for (const row of rows) {
    const list = byMount.get(row.mount) || [];
    list.push({
      usedGb: Number(row.used_gb),
      totalGb: Number(row.total_gb),
      collectedAt: new Date(row.collected_at),
    });
    byMount.set(row.mount, list);
  }

  const label = vm.name || vm.hostname;

  for (const [mount, samples] of byMount) {
    const forecast = forecastDisk(mount, samples);
    const { severity, reason } = evaluateDisk(forecast);

    const projection =
      forecast.daysUntilFull !== null
        ? `Projeção: enche em ${formatHorizon(forecast.daysUntilFull)}`
        : 'Projeção: sem tendência de crescimento na janela';

    const details = [
      `Mount: ${mount}`,
      `Uso atual: ${forecast.usedPercent.toFixed(1)}% (${forecast.usedGb.toFixed(1)} GB de ${forecast.totalGb.toFixed(1)} GB)`,
      projection,
      ...(forecast.growthGbPerDay !== null
        ? [`Crescimento: ${forecast.growthGbPerDay.toFixed(2)} GB/dia (${forecast.sampleCount} amostras em ${vmConfig.disk.trendWindowDays}d)`]
        : [`Amostras na janela: ${forecast.sampleCount} (mínimo ${vmConfig.disk.minSamplesForTrend} para projetar)`]),
    ];

    if (severity === 'critical') {
      await resolveAlert(
        repos.alertRepo,
        vm,
        'disk_warning',
        mount,
        `${label}: ${mount} escalou de atenção para crítico.`,
      );
      await raiseAlert(repos.alertRepo, {
        vm,
        type: 'disk_critical',
        severity: 'critical',
        scope: mount,
        title: `Disco crítico: ${label} (${mount})`,
        message: `Disco ${mount} da VM ${label} em estado crítico — ${reason}.`,
        details,
        currentValue: forecast.usedPercent,
        metadata: {
          mount,
          usedPercent: forecast.usedPercent,
          daysUntilFull: forecast.daysUntilFull,
          growthGbPerDay: forecast.growthGbPerDay,
        },
      });
      continue;
    }

    if (severity === 'warning') {
      await resolveAlert(
        repos.alertRepo,
        vm,
        'disk_critical',
        mount,
        `${label}: ${mount} saiu do estado crítico (agora em atenção).`,
        details,
      );
      await raiseAlert(repos.alertRepo, {
        vm,
        type: 'disk_warning',
        severity: 'warning',
        scope: mount,
        title: `Disco em atenção: ${label} (${mount})`,
        message: `Disco ${mount} da VM ${label} em atenção — ${reason}.`,
        details,
        currentValue: forecast.usedPercent,
        metadata: {
          mount,
          usedPercent: forecast.usedPercent,
          daysUntilFull: forecast.daysUntilFull,
          growthGbPerDay: forecast.growthGbPerDay,
        },
      });
      continue;
    }

    const normalized = `${label}: disco ${mount} normalizado (${forecast.usedPercent.toFixed(1)}% em uso).`;
    await resolveAlert(repos.alertRepo, vm, 'disk_critical', mount, normalized, details);
    await resolveAlert(repos.alertRepo, vm, 'disk_warning', mount, normalized, details);
  }
}

async function recordStatus(
  repo: Repository<VmStatusHistory>,
  vm: Vm,
  status: string,
  source: string,
): Promise<void> {
  const entry = new VmStatusHistory();
  entry.vmId = vm.id;
  entry.status = status;
  entry.source = source;
  // Explícito: a tabela em prod foi criada pelo synchronize do engine, que não gera
  // DEFAULT para esta coluna. Confiar no default do banco quebrava o insert.
  entry.checkedAt = new Date();
  await repo.save(entry);
}

/** Zera o contador só quando há o que zerar: evita um UPDATE por VM por ciclo. */
async function clearProbeFailures(repo: Repository<Vm>, vm: Vm): Promise<void> {
  if (!vm.consecutiveProbeFailures) return;
  vm.consecutiveProbeFailures = 0;
  await repo.update({ id: vm.id }, { consecutiveProbeFailures: 0 });
}
