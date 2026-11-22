import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeploymentService } from './deployment.service';
import { DeploymentController } from './deployment.controller';
import { DeploymentChecklist } from './entities/deployment-checklist.entity';
import { DeploymentChecklistStatus } from './entities/deployment-checklist-status.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeploymentChecklist, DeploymentChecklistStatus]),
  ],
  controllers: [DeploymentController],
  providers: [DeploymentService],
  exports: [DeploymentService],
})
export class DeploymentModule {}
