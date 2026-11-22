import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Service } from './service.entity';

@Entity({ name: 'service_status_history', schema: 'monitoring' })
export class ServiceStatusHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'service_id', length: 100 })
  serviceId: string;

  @Column({ length: 50 })
  status: string;

  @Column({ name: 'cpu_usage', type: 'real', nullable: true })
  cpuUsage: number;

  @Column({ name: 'memory_usage', type: 'real', nullable: true })
  memoryUsage: number;

  @Column({ name: 'disk_usage', type: 'real', nullable: true })
  diskUsage: number;

  @Column({ name: 'network_in', type: 'real', nullable: true })
  networkIn: number;

  @Column({ name: 'network_out', type: 'real', nullable: true })
  networkOut: number;

  @Column({ name: 'error_count', default: 0 })
  errorCount: number;

  @Column({ name: 'warning_count', default: 0 })
  warningCount: number;

  @Column({ name: 'response_time_ms', nullable: true })
  responseTimeMs: number;

  @Column({ name: 'uptime_seconds', type: 'bigint', nullable: true })
  uptimeSeconds: string;

  @CreateDateColumn({ name: 'checked_at' })
  checkedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  // Relacionamento
  @ManyToOne(() => Service, (service) => service.statusHistory)
  @JoinColumn({ name: 'service_id' })
  service: Service;
}
