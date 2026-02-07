import { IsEnum } from 'class-validator';
import { CustomerPlan } from '@prisma/client';

export class UpgradePlanDto {
  @IsEnum(CustomerPlan)
  plan: CustomerPlan;
}
