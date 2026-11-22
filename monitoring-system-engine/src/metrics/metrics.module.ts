import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsGateway } from './metrics.gateway';
import { ServiceStatusHistory } from '../services/entities/service-status-history.entity';
import { ServiceError } from '../services/entities/service-error.entity';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceStatusHistory, ServiceError]),
    ServicesModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsGateway],
  exports: [MetricsService],
})
export class MetricsModule {}
