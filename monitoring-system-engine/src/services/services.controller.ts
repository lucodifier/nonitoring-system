import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseBoolPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ServicesService } from './services.service';
import { DockerService } from './docker.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Services')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('services')
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly dockerService: DockerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all services' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'env', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Services retrieved successfully' })
  async findAll(
    @Query('type') type?: string,
    @Query('env') env?: string,
    @Query('isActive') isActive?: boolean,
  ) {
    return this.servicesService.findAll({ type, env, isActive });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get service by ID' })
  @ApiResponse({ status: 200, description: 'Service retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async findOne(@Param('id') id: string) {
    return this.servicesService.findOne(id);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get current status of a service' })
  @ApiResponse({ status: 200, description: 'Status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Status not found' })
  async getStatus(@Param('id') id: string) {
    return this.servicesService.getServiceStatus(id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get status history of a service' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'History retrieved successfully' })
  async getHistory(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit', new DefaultValuePipe(1000), ParseIntPipe) limit?: number,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.servicesService.getServiceHistory(id, start, end, limit);
  }

  @Get(':id/errors')
  @ApiOperation({ summary: 'Get errors of a service' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'isResolved', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Errors retrieved successfully' })
  async getErrors(
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
    @Query('isResolved') isResolved?: boolean,
  ) {
    return this.servicesService.getServiceErrors(id, limit, isResolved);
  }

  @Get(':id/alerts')
  @ApiOperation({ summary: 'Get alerts of a service' })
  @ApiQuery({ name: 'resolved', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Alerts retrieved successfully' })
  async getAlerts(
    @Param('id') id: string,
    @Query('resolved') resolved?: boolean,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.servicesService.getServiceAlerts(id, resolved, limit);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Start a service container' })
  @ApiResponse({ status: 200, description: 'Service started successfully' })
  @ApiResponse({ status: 400, description: 'Failed to start service' })
  async startService(@Param('id') id: string) {
    return this.dockerService.startService(id);
  }

  @Post(':id/stop')
  @ApiOperation({ summary: 'Stop a service container' })
  @ApiResponse({ status: 200, description: 'Service stopped successfully' })
  @ApiResponse({ status: 400, description: 'Failed to stop service' })
  async stopService(@Param('id') id: string) {
    return this.dockerService.stopService(id);
  }

  @Post(':id/restart')
  @ApiOperation({ summary: 'Restart a service container' })
  @ApiResponse({ status: 200, description: 'Service restarted successfully' })
  @ApiResponse({ status: 400, description: 'Failed to restart service' })
  async restartService(@Param('id') id: string) {
    return this.dockerService.restartService(id);
  }
}
