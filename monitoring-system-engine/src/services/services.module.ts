import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { DockerService } from './docker.service';
import { Service } from './entities/service.entity';
import { ServiceStatusCurrent } from './entities/service-status-current.entity';
import { ServiceStatusHistory } from './entities/service-status-history.entity';
import { ServiceError } from './entities/service-error.entity';
import { ServiceAlert } from './entities/service-alert.entity';

@Module({
  imports: [
    ConfigModule, // ConfigModule já é global, mas importar explicitamente para garantir
    TypeOrmModule.forFeature([
      Service,
      ServiceStatusCurrent,
      ServiceStatusHistory,
      ServiceError,
      ServiceAlert,
    ]),
  ],
  controllers: [ServicesController],
  providers: [ServicesService, DockerService],
  exports: [ServicesService, DockerService, TypeOrmModule],
})
export class ServicesModule {}
