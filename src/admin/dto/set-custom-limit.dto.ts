import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetCustomLimitDto {
  @ApiPropertyOptional({
    example: 1000,
    description: 'Custom monthly notification limit. Set to null to remove the override.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  limit?: number | null;
}
