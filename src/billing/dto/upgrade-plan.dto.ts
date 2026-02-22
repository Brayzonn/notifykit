import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CustomerPlan } from '@prisma/client';

export class UpgradePlanDto {
  @ApiProperty({
    enum: CustomerPlan,
    example: CustomerPlan.INDIE,
    description: 'Plan to upgrade to'
  })
  @IsEnum(CustomerPlan)
  plan: CustomerPlan;
}
