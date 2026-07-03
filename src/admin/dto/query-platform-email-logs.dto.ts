import { IsOptional, IsInt, Min, Max, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlatformEmailStatus } from '@prisma/client';

export class QueryPlatformEmailLogsDto {
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
    description: 'Filter by status',
    enum: PlatformEmailStatus,
  })
  @IsOptional()
  @IsEnum(PlatformEmailStatus)
  status?: PlatformEmailStatus;

  @ApiPropertyOptional({
    description: 'Filter by email type (e.g. otp, welcome, password-reset)',
  })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ description: 'Search by recipient email' })
  @IsOptional()
  @IsString()
  search?: string;
}
