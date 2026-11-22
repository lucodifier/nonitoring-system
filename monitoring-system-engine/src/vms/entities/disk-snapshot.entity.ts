import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Vm } from './vm.entity';

/** Amostra de disco por mount, postada pelo agente dentro da VM a cada 5 min. */
@Entity({ name: 'disk_snapshots', schema: 'monitoring' })
export class DiskSnapshot {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'vm_id', type: 'bigint' })
  vmId: string;

  @Column({ length: 255 })
  mount: string;

  @Column({ name: 'total_gb', type: 'double precision' })
  totalGb: number;

  @Column({ name: 'used_gb', type: 'double precision' })
  usedGb: number;

  @Column({ name: 'collected_at', type: 'timestamp' })
  collectedAt: Date;

  @ManyToOne(() => Vm, (vm) => vm.diskSnapshots)
  @JoinColumn({ name: 'vm_id' })
  vm: Vm;
}
