import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('service_status_history', { schema: 'monitoring' })
export class ServiceStatusHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'service_id' })
  serviceId: string;

  @Column()
  status: string;

  @Column({ name: 'cpu_usage', type: 'double precision', nullable: true })
  cpuUsage: number;

  @Column({ name: 'memory_usage', type: 'double precision', nullable: true })
  memoryUsage: number;

  @Column({ name: 'disk_usage', type: 'double precision', nullable: true })
  diskUsage: number;

  @Column({ name: 'network_in', type: 'double precision', nullable: true })
  networkIn: number;

  @Column({ name: 'network_out', type: 'double precision', nullable: true })
  networkOut: number;

  @Column({ name: 'error_count', type: 'int', default: 0 })
  errorCount: number;

  @Column({ name: 'warning_count', type: 'int', default: 0 })
  warningCount: number;

  @Column({ name: 'response_time_ms', type: 'int', nullable: true })
  responseTimeMs: number;

  @Column({ name: 'uptime_seconds', type: 'bigint', nullable: true })
  uptimeSeconds: number;

  @CreateDateColumn({ name: 'checked_at' })
  checkedAt: Date;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: any;
}
