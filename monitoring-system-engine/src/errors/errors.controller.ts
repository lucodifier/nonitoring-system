import {
  Controller,
  Get,
  Query,
  UseGuards,
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
import { ServicesService } from '../services/services.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Errors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('errors')
export class ErrorsController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get('latest')
  @ApiOperation({ summary: 'Get latest errors across all services' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Latest errors retrieved' })
  async getLatestErrors(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    return this.servicesService.getLatestErrors(limit);
  }
}
