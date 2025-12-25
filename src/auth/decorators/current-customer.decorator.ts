import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedCustomer {
  id: string;
  email: string;
  plan: string;
  monthlyLimit: number;
  usageCount: number;
  usageResetAt: Date;
}

export const CurrentCustomer = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthenticatedCustomer => {
    const request = ctx.switchToHttp().getRequest();
    return request.customer;
  },
);
