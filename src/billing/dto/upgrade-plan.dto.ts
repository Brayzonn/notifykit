import { IsEnum, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CustomerPlan } from '@prisma/client';
import { Currency } from '../interfaces/billing.interface';

export class UpgradePlanDto {
  @ApiProperty({
    enum: CustomerPlan,
    example: CustomerPlan.INDIE,
    description: 'Plan to upgrade to',
  })
  @IsEnum(CustomerPlan)
  plan!: CustomerPlan;

  @ApiProperty({
    enum: ['USD', 'NGN'],
    example: 'USD',
    description:
      'Billing currency. USD routes to Polar, NGN routes to Paystack.',
  })
  @IsIn(['USD', 'NGN'])
  currency!: Currency;
}
