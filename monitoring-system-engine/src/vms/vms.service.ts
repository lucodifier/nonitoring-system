import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, MoreThanOrEqual } from 'typeorm';
import { Vm } from './entities/vm.entity';
import { VmStatusHistory } from './entities/vm-status-history.entity';
import { DiskSnapshot } from './entities/disk-snapshot.entity';
import { VmAlert } from './entities/vm-alert.entity';
import {
  DiskSample,
  DiskThresholds,
  evaluateDisk,
  forecastDisk,
  formatHorizon,
} from './disk-forecast';

export type VmHealth = 'healthy' | 'warning' | 'down' | 'unknown';

@Injectable()
export class VmsService {
  constructor(
    @InjectRepository(Vm)
    private readonly vmRepo: Repository<Vm>,
    @InjectRepository(VmStatusHistory)
    private readonly historyRepo: Repository<VmStatusHistory>,
    @InjectRepository(DiskSnapshot)
    private readonly snapshotRepo: Repository<DiskSnapshot>,
    @InjectRepository(VmAlert)
    private readonly alertRepo: Repository<VmAlert>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Mesmos defaults do worker. Lidos a cada chamada em vez de no boot para que
   * um ajuste no Infisical valha no próximo request, sem redeploy do engine.
   */
  private get thresholds(): DiskThresholds {
    return {
      warningPercent: this.config.get<number>('DISK_WARNING_PERCENT', 80),
      criticalPercent: this.config.get<number>('DISK_CRITICAL_PERCENT', 90),
      forecastWarningDays: this.config.get<number>('DISK_FORECAST_WARNING_DAYS', 7),
      forecastCriticalHours: this.config.get<number>('DISK_FORECAST_CRITICAL_HOURS', 48),
      minSamplesForTrend: this.config.get<number>('DISK_MIN_SAMPLES_FOR_TREND', 3),
    };
  }

  private get trendWindowDays(): number {
    return this.config.get<number>('DISK_TREND_WINDOW_DAYS', 7);
  }

  private get heartbeatMaxAgeMinutes(): number {
    return this.config.get<number>('HEARTBEAT_MAX_AGE_MINUTES', 15);
  }

  /**
   * Lista com o resumo de saúde de cada máquina.
   *
   * Três consultas no total, independente do número de VMs: a lista, o último
   * status de cada uma e o último snapshot de cada mount. A projeção NÃO entra
   * aqui — exigiria a janela inteira de `disk_snapshots` (~288 linhas por mount
   * por dia) de todas as VMs numa tela que atualiza sozinha. Na lista, o risco
   * de disco vem dos alertas que o worker já abriu; a regressão fica no detalhe.
   */
  async findAll(options: { enabled?: boolean } = {}) {
    const where = options.enabled === undefined ? {} : { enabled: options.enabled };
    const vms = await this.vmRepo.find({ where, order: { hostname: 'ASC' } });

    if (vms.length === 0) return [];

    const ids = vms.map((vm) => vm.id);
    const [latestStatus, latestDisks, openAlerts] = await Promise.all([
      this.latestStatusByVm(ids),
      this.latestDiskByVm(ids),
      this.openAlertsByVm(ids),
    ]);

    return vms.map((vm) => {
      const status = latestStatus.get(vm.id) ?? null;
      const disks = latestDisks.get(vm.id) ?? [];
      const alerts = openAlerts.get(vm.id) ?? [];

      return {
        ...this.baseFields(vm),
        status: status?.status ?? null,
        statusSource: status?.source ?? null,
        statusCheckedAt: status?.checkedAt ?? null,
        health: this.rollupHealth(vm, status?.status ?? null, alerts),
        heartbeatAgeMinutes: this.heartbeatAgeMinutes(vm),
        heartbeatStale: this.isHeartbeatStale(vm),
        disks,
        /** Pior mount por percentual — é o que a lista mostra na coluna de disco. */
        worstDisk: disks.length > 0 ? disks[0] : null,
        openAlerts: alerts,
      };
    });
  }

  async findOne(id: string) {
    const vm = await this.vmRepo.findOne({ where: { id } });
    if (!vm) throw new NotFoundException(`VM ${id} não encontrada`);

    const [status, disks, alerts] = await Promise.all([
      this.latestStatusByVm([vm.id]),
      this.diskForecasts(vm.id),
      this.alertRepo.find({
        where: { vmId: vm.id },
        order: { createdAt: 'DESC' },
        take: 50,
      }),
    ]);

    const latest = status.get(vm.id) ?? null;
    const open = alerts.filter((a) => a.resolvedAt === null);

    return {
      ...this.baseFields(vm),
      status: latest?.status ?? null,
      statusSource: latest?.source ?? null,
      statusCheckedAt: latest?.checkedAt ?? null,
      health: this.rollupHealth(vm, latest?.status ?? null, open),
      heartbeatAgeMinutes: this.heartbeatAgeMinutes(vm),
      heartbeatStale: this.isHeartbeatStale(vm),
      disks,
      alerts,
      thresholds: this.thresholds,
    };
  }

  /** Série de estado para a timeline do detalhe. */
  async getStatusHistory(id: string, hours: number) {
    await this.assertExists(id);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    return this.historyRepo.find({
      where: { vmId: id, checkedAt: MoreThanOrEqual(since) },
      order: { checkedAt: 'ASC' },
    });
  }

  /**
   * Amostras de disco da janela, agrupadas por mount — alimenta o gráfico.
   *
   * `days` é limitado no controller: a janela é minuto a minuto no banco e uma
   * VM com muitos mounts e 30 dias devolveria dezenas de milhares de pontos
   * para um gráfico de 600px.
   */
  async getDiskHistory(id: string, days: number) {
    await this.assertExists(id);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await this.snapshotRepo.find({
      where: { vmId: id, collectedAt: MoreThanOrEqual(since) },
      order: { collectedAt: 'ASC' },
    });

    const byMount = new Map<string, DiskSnapshot[]>();
    for (const row of rows) {
      const list = byMount.get(row.mount) ?? [];
      list.push(row);
      byMount.set(row.mount, list);
    }

    return Array.from(byMount.entries()).map(([mount, samples]) => ({
      mount,
      samples: samples.map((s) => ({
        collectedAt: s.collectedAt,
        usedGb: Number(s.usedGb),
        totalGb: Number(s.totalGb),
        usedPercent: Number(s.totalGb) > 0 ? (Number(s.usedGb) / Number(s.totalGb)) * 100 : 0,
      })),
    }));
  }

  async getAlerts(id: string, onlyOpen: boolean) {
    await this.assertExists(id);

    return this.alertRepo.find({
      where: onlyOpen ? { vmId: id, resolvedAt: IsNull() } : { vmId: id },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /**
   * Único caminho de escrita da API.
   *
   * Desligar não apaga histórico: o worker simplesmente para de sondar essa
   * máquina no próximo ciclo (`WHERE enabled = true`). Serve para silenciar uma
   * VM em manutenção sem perder a série que já foi coletada.
   */
  async setEnabled(id: string, enabled: boolean) {
    const vm = await this.vmRepo.findOne({ where: { id } });
    if (!vm) throw new NotFoundException(`VM ${id} não encontrada`);

    await this.vmRepo.update({ id }, { enabled });
    return { ...this.baseFields(vm), enabled };
  }

  /** Contadores do topo da tela. */
  async getSummary() {
    const vms = await this.findAll();

    return {
      total: vms.length,
      enabled: vms.filter((vm) => vm.enabled).length,
      healthy: vms.filter((vm) => vm.health === 'healthy').length,
      warning: vms.filter((vm) => vm.health === 'warning').length,
      down: vms.filter((vm) => vm.health === 'down').length,
      unknown: vms.filter((vm) => vm.health === 'unknown').length,
      openAlerts: vms.reduce((acc, vm) => acc + vm.openAlerts.length, 0),
    };
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private baseFields(vm: Vm) {
    return {
      id: String(vm.id),
      hostname: vm.hostname,
      name: vm.name,
      ip: vm.ip,
      providerId: vm.providerId,
      enabled: vm.enabled,
      lastHeartbeatAt: vm.lastHeartbeatAt,
      consecutiveProbeFailures: vm.consecutiveProbeFailures,
    };
  }

  private async assertExists(id: string) {
    const exists = await this.vmRepo.exists({ where: { id } });
    if (!exists) throw new NotFoundException(`VM ${id} não encontrada`);
  }

  /**
   * DISTINCT ON em vez de uma consulta por VM: o índice (vm_id, checked_at DESC)
   * criado pela migration serve exatamente este acesso.
   */
  private async latestStatusByVm(ids: string[]) {
    const rows: Array<{ vm_id: string; status: string; source: string | null; checked_at: Date }> =
      await this.historyRepo.query(
        `SELECT DISTINCT ON (vm_id) vm_id, status, source, checked_at
           FROM monitoring.vm_status_history
          WHERE vm_id = ANY($1::bigint[])
          ORDER BY vm_id, checked_at DESC`,
        [ids],
      );

    return new Map(
      rows.map((r) => [
        String(r.vm_id),
        { status: r.status, source: r.source, checkedAt: r.checked_at },
      ]),
    );
  }

  /** Último snapshot de cada (vm, mount), ordenado do mount mais cheio para o mais vazio. */
  private async latestDiskByVm(ids: string[]) {
    const rows: Array<{
      vm_id: string;
      mount: string;
      total_gb: number;
      used_gb: number;
      collected_at: Date;
    }> = await this.snapshotRepo.query(
      `SELECT DISTINCT ON (vm_id, mount) vm_id, mount, total_gb, used_gb, collected_at
         FROM monitoring.disk_snapshots
        WHERE vm_id = ANY($1::bigint[])
        ORDER BY vm_id, mount, collected_at DESC`,
      [ids],
    );

    const byVm = new Map<string, any[]>();
    for (const row of rows) {
      const totalGb = Number(row.total_gb);
      const usedGb = Number(row.used_gb);
      const list = byVm.get(String(row.vm_id)) ?? [];

      list.push({
        mount: row.mount,
        totalGb,
        usedGb,
        usedPercent: totalGb > 0 ? (usedGb / totalGb) * 100 : 0,
        collectedAt: row.collected_at,
      });

      byVm.set(String(row.vm_id), list);
    }

    for (const list of byVm.values()) {
      list.sort((a, b) => b.usedPercent - a.usedPercent);
    }

    return byVm;
  }

  private async openAlertsByVm(ids: string[]) {
    const alerts = await this.alertRepo.find({
      where: { vmId: In(ids), resolvedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    const byVm = new Map<string, VmAlert[]>();
    for (const alert of alerts) {
      const list = byVm.get(String(alert.vmId)) ?? [];
      list.push(alert);
      byVm.set(String(alert.vmId), list);
    }

    return byVm;
  }

  /** Projeção por mount, com a mesma conta e os mesmos limites do worker. */
  private async diskForecasts(vmId: string) {
    const thresholds = this.thresholds;
    const since = new Date(Date.now() - this.trendWindowDays * 24 * 60 * 60 * 1000);

    const rows = await this.snapshotRepo.find({
      where: { vmId, collectedAt: MoreThanOrEqual(since) },
      order: { collectedAt: 'ASC' },
    });

    const byMount = new Map<string, DiskSample[]>();
    for (const row of rows) {
      const list = byMount.get(row.mount) ?? [];
      list.push({
        usedGb: Number(row.usedGb),
        totalGb: Number(row.totalGb),
        collectedAt: row.collectedAt,
      });
      byMount.set(row.mount, list);
    }

    const forecasts = Array.from(byMount.entries()).map(([mount, samples]) => {
      const forecast = forecastDisk(mount, samples, thresholds);
      const evaluation = evaluateDisk(forecast, thresholds);

      return {
        ...forecast,
        severity: evaluation.severity,
        reason: evaluation.reason,
        horizon: forecast.daysUntilFull === null ? null : formatHorizon(forecast.daysUntilFull),
      };
    });

    return forecasts.sort((a, b) => b.usedPercent - a.usedPercent);
  }

  private heartbeatAgeMinutes(vm: Vm): number | null {
    if (!vm.lastHeartbeatAt) return null;
    return (Date.now() - new Date(vm.lastHeartbeatAt).getTime()) / 60000;
  }

  /**
   * VM que nunca mandou heartbeat não é "atrasada" — é VM sem agente instalado.
   * Mesma regra do worker, que não abre `no_heartbeat` nesse caso.
   */
  private isHeartbeatStale(vm: Vm): boolean {
    const age = this.heartbeatAgeMinutes(vm);
    return age !== null && age > this.heartbeatMaxAgeMinutes;
  }

  /**
   * Saúde consolidada da máquina.
   *
   * Os alertas abertos têm precedência sobre o último status: é o worker que
   * decide o que é problema, e a tela não deve discordar da mensagem que já foi
   * para o chat. VM desabilitada sai como 'unknown' — não é saudável, é apenas
   * não observada, e pintar de verde o que ninguém está olhando é pior que
   * deixar cinza.
   */
  private rollupHealth(vm: Vm, status: string | null, openAlerts: VmAlert[]): VmHealth {
    if (!vm.enabled) return 'unknown';
    if (openAlerts.some((a) => a.severity === 'critical')) return 'down';
    if (status === 'stopped' || status === 'unreachable') return 'down';
    if (openAlerts.length > 0) return 'warning';
    if (status === 'paused') return 'warning';
    if (this.isHeartbeatStale(vm)) return 'warning';
    if (status === 'running') return 'healthy';
    if (vm.lastHeartbeatAt) return 'healthy';
    return 'unknown';
  }
}
