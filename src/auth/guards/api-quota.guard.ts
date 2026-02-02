import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { CustomerPlan, SubscriptionStatus } from '@prisma/client';
import { AuthenticatedCustomer } from '../interfaces/api-guard.interface';
import { AuthService } from '../auth.service';

interface CustomerRequest extends Request {
  customer: AuthenticatedCustomer;
}

@Injectable()
export class QuotaGuard implements CanActivate {
  private readonly logger = new Logger(QuotaGuard.name);
  private readonly GRACE_PERIOD_DAYS = 7;

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const customer = request.customer;

    if (!customer) {
      throw new HttpException(
        'Customer not authenticated',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const now = new Date();

    // Handle billing cycle reset
    if (customer.usageResetAt < now) {
      await this.handleBillingCycleReset(customer, now);
    }

    // Check usage limit
    const currentUsage = customer.usageCount ?? 0;
    if (currentUsage >= customer.monthlyLimit) {
      this.logger.warn(
        `Usage limit exceeded for ${customer.email}: ${currentUsage}/${customer.monthlyLimit}`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        message: `Monthly usage limit exceeded (${currentUsage}/${customer.monthlyLimit}). Upgrade your plan or wait for reset on ${customer.usageResetAt.toLocaleDateString()}.`,
        error: 'Forbidden',
      });
    }

    // Increment usage
    await this.authService.incrementUsage(customer.id);
    customer.usageCount = currentUsage + 1;

    this.logger.debug(
      `Usage: ${customer.email} ${customer.usageCount}/${customer.monthlyLimit}`,
    );

    return true;
  }

  private async handleBillingCycleReset(
    customer: AuthenticatedCustomer,
    now: Date,
  ): Promise<void> {
    if (customer.plan === CustomerPlan.FREE) {
      await this.authService.resetMonthlyUsage(customer.id);
      this.syncCustomerInMemory(customer);

      this.logger.log(`Reset FREE plan customer: ${customer.email}`);
      return;
    }

    // Paid plans - check subscription
    const hasActiveSubscription =
      customer.subscriptionStatus === SubscriptionStatus.ACTIVE &&
      customer.subscriptionEndDate &&
      customer.subscriptionEndDate > now;

    if (hasActiveSubscription) {
      await this.authService.resetMonthlyUsage(customer.id);
      this.syncCustomerInMemory(customer);

      this.logger.log(`Reset ${customer.plan} customer: ${customer.email}`);
      return;
    }

    // Subscription expired - check grace period
    const isInGracePeriod = this.checkGracePeriod(
      customer.subscriptionEndDate,
      now,
    );

    if (isInGracePeriod) {
      await this.authService.resetMonthlyUsage(customer.id);
      this.syncCustomerInMemory(customer);

      const daysLeft = this.getDaysLeft(customer.subscriptionEndDate, now);
      this.logger.warn(
        `Customer ${customer.email} in grace period (${daysLeft} days left)`,
      );
    } else {
      // Grace period over - downgrade
      await this.authService.downgradeToFreePlan(
        customer.id,
        'SUBSCRIPTION_EXPIRED',
      );

      // Sync in-memory for current request
      customer.plan = CustomerPlan.FREE;
      customer.monthlyLimit = 1000;
      this.syncCustomerInMemory(customer);

      this.logger.warn(
        `Customer ${customer.email} downgraded to FREE (subscription expired)`,
      );
    }
  }

  private checkGracePeriod(
    subscriptionEndDate: Date | undefined,
    now: Date,
  ): boolean {
    if (!subscriptionEndDate) return false;

    const gracePeriodEnd = new Date(
      subscriptionEndDate.getTime() +
        this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );

    return now <= gracePeriodEnd;
  }

  private getDaysLeft(
    subscriptionEndDate: Date | undefined,
    now: Date,
  ): number {
    if (!subscriptionEndDate) return 0;

    const gracePeriodEnd = new Date(
      subscriptionEndDate.getTime() +
        this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );

    return Math.ceil(
      (gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  private syncCustomerInMemory(customer: AuthenticatedCustomer): void {
    const resetDate = new Date();
    resetDate.setDate(resetDate.getDate() + 30);

    customer.usageCount = 0;
    customer.usageResetAt = resetDate;
    customer.billingCycleStartAt = new Date();
  }
}
