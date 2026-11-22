import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { ServiceStatusCurrent } from './service-status-current.entity';
import { ServiceStatusHistory } from './service-status-history.entity';
import { ServiceError } from './service-error.entity';
import { ServiceAlert } from './service-alert.entity';

@Entity({ name: 'services', schema: 'monitoring' })
export class Service {
  @PrimaryColumn({ length: 100 })
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 50 })
  type: string; // 'api', 'worker', 'database', 'website', 'microservice'

  @Column({ length: 50, default: 'production' })
  env: string; // 'production', 'staging', 'development'

  @Column({ name: 'container_id', length: 255, nullable: true })
  containerId: string;

  @Column({ type: 'text', nullable: true })
  url: string;

  @Column({ name: 'prometheus_job', length: 255, nullable: true })
  prometheusJob: string;

  @Column({ name: 'loki_label', length: 255, nullable: true })
  lokiLabel: string;

  @Column({ length: 50, default: 'medium' })
  importance: string; // 'critical', 'high', 'medium', 'low'

  @Column({ length: 100, nullable: true })
  team: string;

  @Column({ name: 'repository_url', type: 'text', nullable: true })
  repositoryUrl: string;

  @Column({ name: 'documentation_url', type: 'text', nullable: true })
  documentationUrl: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relacionamentos
  @OneToOne(() => ServiceStatusCurrent, (status) => status.service)
  currentStatus: ServiceStatusCurrent;

  @OneToMany(() => ServiceStatusHistory, (history) => history.service)
  statusHistory: ServiceStatusHistory[];

  @OneToMany(() => ServiceError, (error) => error.service)
  errors: ServiceError[];

  @OneToMany(() => ServiceAlert, (alert) => alert.service)
  alerts: ServiceAlert[];
}
