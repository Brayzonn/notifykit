import { IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ResetCustomerUsageDto {
  @ApiPropertyOptional({
    description: 'New usage count (defaults to 0)',
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  usageCount?: number = 0;
}
