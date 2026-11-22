import { Module } from '@nestjs/common';
import { ErrorsController } from './errors.controller';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [ServicesModule],
  controllers: [ErrorsController],
})
export class ErrorsModule {}
