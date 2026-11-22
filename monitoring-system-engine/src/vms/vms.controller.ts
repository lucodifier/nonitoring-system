import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { VmsService } from './vms.service';
import { UpdateVmEnabledDto } from './dto/update-vm-enabled.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('VMs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vms')
export class VmsController {
  constructor(private readonly vmsService: VmsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as máquinas com o resumo de saúde' })
  @ApiQuery({ name: 'enabled', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Lista retornada com sucesso' })
  async findAll(@Query('enabled') enabled?: string) {
    const parsed = enabled === undefined ? undefined : enabled === 'true';
    return this.vmsService.findAll({ enabled: parsed });
  }

  /**
   * Antes de ':id' de propósito: com a ordem invertida, 'summary' cairia no
   * parâmetro e viraria uma busca por uma VM de id "summary".
   */
  @Get('summary')
  @ApiOperation({ summary: 'Contadores por estado de saúde' })
  @ApiResponse({ status: 200, description: 'Resumo retornado com sucesso' })
  async getSummary() {
    return this.vmsService.getSummary();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da máquina, com projeção de disco por mount' })
  @ApiResponse({ status: 200, description: 'VM retornada com sucesso' })
  @ApiResponse({ status: 404, description: 'VM não encontrada' })
  async findOne(@Param('id') id: string) {
    return this.vmsService.findOne(id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Histórico de estado da máquina' })
  @ApiQuery({ name: 'hours', required: false, type: Number, description: 'Padrão 24, máx 720' })
  async getHistory(
    @Param('id') id: string,
    @Query('hours', new DefaultValuePipe(24), ParseIntPipe) hours: number,
  ) {
    return this.vmsService.getStatusHistory(id, Math.min(Math.max(hours, 1), 720));
  }

  @Get(':id/disks')
  @ApiOperation({ summary: 'Série de uso de disco por mount' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Padrão 7, máx 30' })
  async getDisks(
    @Param('id') id: string,
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
  ) {
    return this.vmsService.getDiskHistory(id, Math.min(Math.max(days, 1), 30));
  }

  @Get(':id/alerts')
  @ApiOperation({ summary: 'Alertas da máquina' })
  @ApiQuery({ name: 'onlyOpen', required: false, type: Boolean })
  async getAlerts(
    @Param('id') id: string,
    @Query('onlyOpen', new DefaultValuePipe(false), ParseBoolPipe) onlyOpen: boolean,
  ) {
    return this.vmsService.getAlerts(id, onlyOpen);
  }

  @Patch(':id/enabled')
  @ApiOperation({ summary: 'Liga ou desliga o monitoramento da máquina' })
  @ApiResponse({ status: 200, description: 'Estado atualizado' })
  @ApiResponse({ status: 404, description: 'VM não encontrada' })
  async setEnabled(@Param('id') id: string, @Body() dto: UpdateVmEnabledDto) {
    return this.vmsService.setEnabled(id, dto.enabled);
  }
}
