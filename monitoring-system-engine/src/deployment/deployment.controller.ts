import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { DeploymentService } from './deployment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateChecklistStatusDto } from './dto/update-checklist-status.dto';

@ApiTags('Deployment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('deployment')
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Get('checklist')
  @ApiOperation({ summary: 'Get deployment checklist' })
  @ApiQuery({ name: 'category', required: false })
  @ApiResponse({
    status: 200,
    description: 'Checklist retrieved successfully',
  })
  async getChecklist(@Query('category') category?: string) {
    return this.deploymentService.getChecklistWithLatestStatus();
  }

  @Get('status')
  @ApiOperation({ summary: 'Get deployment readiness status' })
  @ApiResponse({ status: 200, description: 'Status retrieved successfully' })
  async getStatus() {
    return this.deploymentService.getDeploymentStatus();
  }

  @Patch('checklist/:id')
  @ApiOperation({ summary: 'Update checklist item status' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  @ApiResponse({ status: 404, description: 'Checklist item not found' })
  async updateChecklistStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateChecklistStatusDto,
  ) {
    return this.deploymentService.updateChecklistStatus(
      id,
      updateDto.status,
      updateDto.checkedBy,
      updateDto.notes,
      updateDto.evidenceUrl,
    );
  }
}
