import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Amostra de uso de disco enviada pelo agente dentro da VM.
 * É a série que alimenta a regressão linear da projeção de enchimento.
 */
@Entity('disk_snapshots', { schema: 'monitoring' })
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

  @CreateDateColumn({ name: 'collected_at' })
  collectedAt: Date;
}
