import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type VmAlertType = 'down' | 'paused' | 'disk_warning' | 'disk_critical' | 'no_heartbeat';

/**
 * Alerta de VM. Tabela separada de `service_alerts` de propósito: o alvo aqui é a
 * máquina (vm_id), não o serviço (service_id varchar), e misturar as duas quebraria
 * a FK e os JOINs do dashboard.
 *
 * `resolved_at` nulo = alerta aberto. O anti-spam olha `created_at` do último alerta
 * aberto do mesmo (vm_id, type) -- no banco, e não em memória, para o cooldown
 * sobreviver a restart/deploy do container.
 */
@Entity('vm_alerts', { schema: 'monitoring' })
export class VmAlert {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'vm_id', type: 'bigint' })
  vmId: string;

  @Column({ length: 50 })
  type: VmAlertType;

  @Column({ type: 'text' })
  message: string;

  /** critical | warning */
  @Column({ length: 50 })
  severity: string;

  /** Chave secundária do alerta (ex: o mount, nos alertas de disco). */
  @Column({ length: 255, nullable: true })
  scope: string;

  @Column({ name: 'current_value', type: 'double precision', nullable: true })
  currentValue: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @Column({ name: 'notified_at', type: 'timestamp', nullable: true })
  notifiedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date;
}
