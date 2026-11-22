import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { DeploymentChecklistStatus } from './deployment-checklist-status.entity';

@Entity({ name: 'deployment_checklist', schema: 'monitoring' })
export class DeploymentChecklist {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'item_name', length: 255 })
  itemName: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 100 })
  category: string; // 'infrastructure', 'security', 'monitoring', 'testing', 'documentation'

  @Column({ default: 0 })
  priority: number;

  @Column({ name: 'is_required', default: true })
  isRequired: boolean;

  @Column({ name: 'validation_script', type: 'text', nullable: true })
  validationScript: string;

  @Column({ name: 'documentation_url', type: 'text', nullable: true })
  documentationUrl: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relacionamento
  @OneToMany(() => DeploymentChecklistStatus, (status) => status.checklistItem)
  statuses: DeploymentChecklistStatus[];
}
