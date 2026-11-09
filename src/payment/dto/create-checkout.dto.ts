import { IsEnum } from 'class-validator';
import { CustomerPlan } from '@/generated/prisma/client';

export class CreateCheckoutDto {
  @IsEnum(CustomerPlan)
  plan!: CustomerPlan;
}
