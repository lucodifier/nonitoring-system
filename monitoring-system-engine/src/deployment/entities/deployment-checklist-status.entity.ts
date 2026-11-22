import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DeploymentChecklist } from './deployment-checklist.entity';

@Entity({ name: 'deployment_checklist_status', schema: 'monitoring' })
export class DeploymentChecklistStatus {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'checklist_item_id' })
  checklistItemId: number;

  @Column({ default: false })
  status: boolean;

  @Column({ name: 'checked_by', length: 100, nullable: true })
  checkedBy: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'evidence_url', type: 'text', nullable: true })
  evidenceUrl: string;

  @Column({ name: 'checked_at', type: 'timestamp', nullable: true })
  checkedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date;

  // Relacionamento
  @ManyToOne(() => DeploymentChecklist, (checklist) => checklist.statuses)
  @JoinColumn({ name: 'checklist_item_id' })
  checklistItem: DeploymentChecklist;
}
