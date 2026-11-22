import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Uma linha por VM por ciclo: série temporal de estado, usada para auditoria e para o dashboard. */
@Entity('vm_status_history', { schema: 'monitoring' })
export class VmStatusHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'vm_id', type: 'bigint' })
  vmId: string;

  /** running | stopped | paused | unreachable | unknown */
  @Column({ length: 50 })
  status: string;

  /** De onde veio o estado: proxmox-ssh, libvirt-ssh, probe, heartbeat, ... */
  @Column({ length: 50, nullable: true })
  source: string;

  @CreateDateColumn({ name: 'checked_at' })
  checkedAt: Date;
}
