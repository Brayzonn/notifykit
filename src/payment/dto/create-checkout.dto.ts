import { IsEnum } from 'class-validator';
import { CustomerPlan } from '@prisma/client';

export class CreateCheckoutDto {
  @IsEnum(CustomerPlan)
  plan: CustomerPlan;
}
