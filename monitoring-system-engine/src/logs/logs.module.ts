import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LokiService } from './loki.service';

@Module({
  controllers: [LogsController],
  providers: [LokiService],
  exports: [LokiService],
})
export class LogsModule {}
