import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelSubscriptionDto {
  @ApiPropertyOptional({
    example: 'No longer need the service',
    description: 'Reason for cancellation'
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
