import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Service } from './service.entity';

@Entity({ name: 'service_alerts', schema: 'monitoring' })
export class ServiceAlert {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'service_id', length: 100 })
  serviceId: string;

  @Column({ name: 'alert_type', length: 50 })
  alertType: string; // 'down', 'restart', 'error', 'degraded', 'high_cpu', 'high_memory'

  @Column({ length: 50 })
  severity: string; // 'critical', 'warning', 'info'

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'threshold_value', type: 'real', nullable: true })
  thresholdValue: number;

  @Column({ name: 'current_value', type: 'real', nullable: true })
  currentValue: number;

  @Column({ default: false })
  resolved: boolean;

  @Column({ default: false })
  notified: boolean;

  @Column({ name: 'notification_channels', type: 'jsonb', nullable: true })
  notificationChannels: string[];

  @Column({ default: false })
  acknowledged: boolean;

  @Column({ name: 'acknowledged_by', length: 100, nullable: true })
  acknowledgedBy: string;

  @Column({ name: 'acknowledged_at', type: 'timestamp', nullable: true })
  acknowledgedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date;

  @Column({ name: 'resolved_by', length: 100, nullable: true })
  resolvedBy: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  // Relacionamento
  @ManyToOne(() => Service, (service) => service.alerts)
  @JoinColumn({ name: 'service_id' })
  service: Service;
}
