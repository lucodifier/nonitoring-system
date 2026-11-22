import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VmsController } from './vms.controller';
import { VmsService } from './vms.service';
import { Vm } from './entities/vm.entity';
import { VmStatusHistory } from './entities/vm-status-history.entity';
import { DiskSnapshot } from './entities/disk-snapshot.entity';
import { VmAlert } from './entities/vm-alert.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Vm, VmStatusHistory, DiskSnapshot, VmAlert]),
  ],
  controllers: [VmsController],
  providers: [VmsService],
  exports: [VmsService, TypeOrmModule],
})
export class VmsModule {}
