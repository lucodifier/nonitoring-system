import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [ServicesModule],
  controllers: [AlertsController],
})
export class AlertsModule {}
