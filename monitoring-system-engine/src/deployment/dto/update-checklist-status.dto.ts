import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class UpdateChecklistStatusDto {
  @ApiProperty({ example: true, description: 'Status of the checklist item' })
  @IsBoolean()
  @IsNotEmpty()
  status: boolean;

  @ApiProperty({ example: 'admin', description: 'Username of who checked' })
  @IsString()
  @IsNotEmpty()
  checkedBy: string;

  @ApiProperty({
    example: 'Verified all configurations',
    description: 'Optional notes',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    example: 'https://example.com/evidence.png',
    description: 'Optional evidence URL',
    required: false,
  })
  @IsString()
  @IsOptional()
  evidenceUrl?: string;
}
