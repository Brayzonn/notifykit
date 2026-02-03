import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { JobStatus, JobType } from '@prisma/client';

export class GetJobsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @IsOptional()
  @IsEnum(JobType)
  type?: JobType;
}
