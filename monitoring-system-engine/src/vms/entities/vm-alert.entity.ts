import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Vm } from './vm.entity';

/**
 * Alertas de máquina. Tabela separada de `service_alerts` de propósito: o alvo
 * aqui é a VM (`vm_id` bigint), não o serviço (`service_id` varchar).
 */
@Entity({ name: 'vm_alerts', schema: 'monitoring' })
export class VmAlert {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'vm_id', type: 'bigint' })
  vmId: string;

  /** 'down' | 'paused' | 'no_heartbeat' | 'disk_warning' | 'disk_critical' */
  @Column({ length: 50 })
  type: string;

  @Column({ type: 'text' })
  message: string;

  /** 'critical' | 'warning' | 'info' */
  @Column({ length: 50 })
  severity: string;

  /** Qualifica o alvo dentro da VM — hoje, o mount do disco. */
  @Column({ length: 255, nullable: true })
  scope: string | null;

  @Column({ name: 'current_value', type: 'double precision', nullable: true })
  currentValue: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  /** Quando a mensagem foi entregue no chat. É daqui que sai o cooldown. */
  @Column({ name: 'notified_at', type: 'timestamp', nullable: true })
  notifiedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @ManyToOne(() => Vm, (vm) => vm.alerts)
  @JoinColumn({ name: 'vm_id' })
  vm: Vm;
}
