import { IsOptional, IsInt, Min, Max, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerPlan } from '@prisma/client';

export class QueryCustomersDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by plan',
    enum: CustomerPlan,
  })
  @IsOptional()
  @IsEnum(CustomerPlan)
  plan?: CustomerPlan;

  @ApiPropertyOptional({
    description: 'Search by email',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
