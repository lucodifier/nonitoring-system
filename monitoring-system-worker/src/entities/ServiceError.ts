import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Erros observados no log de um serviço.
 *
 * A tabela existia e o engine já a lia (GET /services/:id/errors, exibida no
 * dashboard), mas nada nunca escrevia nela — por isso o painel "recent logs" da
 * tela do serviço sempre apareceu vazio. O worker passa a gravar aqui a linha de
 * erro que já extrai do stdout do container.
 *
 * Espelha monitoring-system-engine/src/services/entities/service-error.entity.ts.
 */
@Entity('service_errors', { schema: 'monitoring' })
export class ServiceError {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'service_id', length: 100 })
  serviceId: string;

  @Column({ name: 'error_message', type: 'text' })
  errorMessage: string;

  @Column({ name: 'error_type', length: 100, nullable: true })
  errorType: string;

  @Column({ name: 'error_level', length: 50, default: 'error' })
  errorLevel: string;

  @Column({ name: 'stack_trace', type: 'text', nullable: true })
  stackTrace: string;

  @Column({ type: 'jsonb', nullable: true })
  context: any;

  @Column({ name: 'loki_url', type: 'text', nullable: true })
  lokiUrl: string;

  @Column({ name: 'grafana_url', type: 'text', nullable: true })
  grafanaUrl: string;

  @Column({ name: 'is_resolved', default: false })
  isResolved: boolean;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date;

  @Column({ name: 'resolved_by', length: 100, nullable: true })
  resolvedBy: string;

  @CreateDateColumn({ name: 'occurred_at' })
  occurredAt: Date;
}
