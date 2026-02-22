import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CustomerPlan } from '@prisma/client';

export class UpdateCustomerPlanDto {
  @ApiProperty({
    description: 'Customer plan',
    enum: CustomerPlan,
  })
  @IsEnum(CustomerPlan)
  plan: CustomerPlan;
}
