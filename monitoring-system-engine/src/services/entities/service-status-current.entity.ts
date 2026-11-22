import {
  Entity,
  Column,
  PrimaryColumn,
  JoinColumn,
  OneToOne,
  CreateDateColumn,
} from 'typeorm';
import { Service } from './service.entity';

@Entity({ name: 'service_status_current', schema: 'monitoring' })
export class ServiceStatusCurrent {
  @PrimaryColumn({ name: 'service_id', length: 100 })
  serviceId: string;

  @Column({ length: 50 })
  status: string; // 'UP', 'DOWN', 'DEGRADED', 'UNKNOWN'

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

  @Column({ name: 'restart_count', default: 0 })
  restartCount: number;

  @Column({ name: 'response_time_ms', nullable: true })
  responseTimeMs: number;

  @Column({ name: 'uptime_seconds', type: 'bigint', nullable: true })
  uptimeSeconds: string;

  @Column({ name: 'last_change', type: 'timestamp', nullable: true })
  lastChange: Date;

  @CreateDateColumn({ name: 'last_check' })
  lastCheck: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  // Relacionamento
  @OneToOne(() => Service, (service) => service.currentStatus)
  @JoinColumn({ name: 'service_id' })
  service: Service;
}
