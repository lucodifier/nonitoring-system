import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateVmEnabledDto {
  @ApiProperty({
    example: true,
    description: 'Se false, o worker para de sondar esta máquina no próximo ciclo',
  })
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;
}
