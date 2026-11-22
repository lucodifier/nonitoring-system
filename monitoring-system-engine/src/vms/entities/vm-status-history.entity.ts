import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Vm } from './vm.entity';

/** Série de estado da máquina, uma linha por ciclo do worker. */
@Entity({ name: 'vm_status_history', schema: 'monitoring' })
export class VmStatusHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'vm_id', type: 'bigint' })
  vmId: string;

  /** 'running' | 'stopped' | 'paused' | 'unreachable' | 'unknown' */
  @Column({ length: 50 })
  status: string;

  /** De onde veio a informação: 'hypervisor' | 'probe' | 'heartbeat'. */
  @Column({ length: 50, nullable: true })
  source: string | null;

  @Column({ name: 'checked_at', type: 'timestamp' })
  checkedAt: Date;

  @ManyToOne(() => Vm, (vm) => vm.statusHistory)
  @JoinColumn({ name: 'vm_id' })
  vm: Vm;
}
