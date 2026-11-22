import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VmStatusHistory } from './vm-status-history.entity';
import { DiskSnapshot } from './disk-snapshot.entity';
import { VmAlert } from './vm-alert.entity';

/**
 * Máquinas (VMs e hosts físicos) monitoradas pelo worker.
 *
 * O schema é mantido pelo monitoring-system-worker (docs/sql/vm-monitoring.sql
 * ou a migration CreateVmMonitoring). Aqui as entities são só de leitura —
 * a única escrita da API é o campo `enabled`.
 */
@Entity({ name: 'vms', schema: 'monitoring' })
export class Vm {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** Precisa ser exatamente o que o agente envia (`hostname` / %COMPUTERNAME%). */
  @Column({ length: 255, unique: true })
  hostname: string;

  @Column({ length: 45, nullable: true })
  ip: string | null;

  /** ID da VM no hypervisor (VMID no Proxmox, nome do domínio no libvirt). */
  @Column({ name: 'provider_id', length: 255, nullable: true })
  providerId: string | null;

  @Column({ length: 255, nullable: true })
  name: string | null;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'last_heartbeat_at', type: 'timestamp', nullable: true })
  lastHeartbeatAt: Date | null;

  @Column({ name: 'consecutive_probe_failures', type: 'int', default: 0 })
  consecutiveProbeFailures: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => VmStatusHistory, (history) => history.vm)
  statusHistory: VmStatusHistory[];

  @OneToMany(() => DiskSnapshot, (snapshot) => snapshot.vm)
  diskSnapshots: DiskSnapshot[];

  @OneToMany(() => VmAlert, (alert) => alert.vm)
  alerts: VmAlert[];
}
