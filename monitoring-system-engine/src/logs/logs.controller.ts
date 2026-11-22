import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LokiService } from './loki.service';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('logs')
export class LogsController {
  constructor(private readonly lokiService: LokiService) {}

  @Get(':serviceName')
  @ApiOperation({ summary: 'Get logs for a specific service' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'start', required: false, type: String })
  @ApiQuery({ name: 'end', required: false, type: String })
  @ApiQuery({ name: 'level', required: false, type: String, description: 'Filter by log level (e.g., "error", "warn")' })
  @ApiQuery({ name: 'env', required: false, type: String, description: 'Loki env label: prod, stg or dev. Overrides engine env so you can query prod from any instance.' })
  async getServiceLogs(
    @Param('serviceName') serviceName: string,
    @Query('limit') limit?: number,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('level') level?: string,
    @Query('env') env?: string,
  ) {
    return this.lokiService.getLogs(serviceName, limit || 100, start, end, level, env);
  }
}
