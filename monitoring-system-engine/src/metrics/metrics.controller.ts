import {
  Controller,
  Get,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { ServicesService } from '../services/services.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Metrics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly servicesService: ServicesService,
  ) {}

  @Get('dashboard-summary')
  @ApiOperation({ summary: 'Get dashboard summary with all key metrics' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard summary retrieved successfully',
  })
  async getDashboardSummary() {
    return this.servicesService.getDashboardSummary();
  }

  @Get('cpu/:serviceId')
  @ApiOperation({ summary: 'Get CPU usage metrics for a service' })
  @ApiQuery({ name: 'hours', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'CPU metrics retrieved' })
  async getCpuMetrics(
    @Param('serviceId') serviceId: string,
    @Query('hours', new DefaultValuePipe(24), ParseIntPipe) hours?: number,
  ) {
    return this.metricsService.getCpuMetrics(serviceId, hours);
  }

  @Get('memory/:serviceId')
  @ApiOperation({ summary: 'Get memory usage metrics for a service' })
  @ApiQuery({ name: 'hours', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Memory metrics retrieved' })
  async getMemoryMetrics(
    @Param('serviceId') serviceId: string,
    @Query('hours', new DefaultValuePipe(24), ParseIntPipe) hours?: number,
  ) {
    return this.metricsService.getMemoryMetrics(serviceId, hours);
  }

  @Get('errors-per-minute')
  @ApiOperation({ summary: 'Get errors per minute for all or specific service' })
  @ApiQuery({ name: 'serviceId', required: false })
  @ApiQuery({ name: 'minutes', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Error metrics retrieved' })
  async getErrorsPerMinute(
    @Query('serviceId') serviceId?: string,
    @Query('minutes', new DefaultValuePipe(60), ParseIntPipe) minutes?: number,
  ) {
    return this.metricsService.getErrorsPerMinute(serviceId, minutes);
  }

  @Get('uptime/:serviceId')
  @ApiOperation({ summary: 'Get uptime percentage for a service' })
  @ApiQuery({ name: 'hours', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Uptime metrics retrieved' })
  async getUptime(
    @Param('serviceId') serviceId: string,
    @Query('hours', new DefaultValuePipe(24), ParseIntPipe) hours?: number,
  ) {
    return this.metricsService.getServiceUptime(serviceId, hours);
  }

  @Get('multi-service')
  @ApiOperation({ summary: 'Get metrics for multiple services' })
  @ApiQuery({ name: 'serviceIds', required: true, description: 'Comma-separated service IDs' })
  @ApiQuery({ name: 'metric', required: true, enum: ['cpu', 'memory'] })
  @ApiQuery({ name: 'hours', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Multi-service metrics retrieved' })
  async getMultiServiceMetrics(
    @Query('serviceIds') serviceIds: string,
    @Query('metric') metric: 'cpu' | 'memory',
    @Query('hours', new DefaultValuePipe(24), ParseIntPipe) hours?: number,
  ) {
    const ids = serviceIds.split(',').map((id) => id.trim());
    return this.metricsService.getMultiServiceMetrics(ids, metric, hours);
  }
}
