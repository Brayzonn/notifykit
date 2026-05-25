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
import { BillingService } from '@/billing/billing.service';
import { getPlanLimit } from '@/common/constants/plans.constants';

interface CustomerRequest extends Request {
  customer: AuthenticatedCustomer;
}

@Injectable()
export class QuotaGuard implements CanActivate {
  private readonly logger = new Logger(QuotaGuard.name);
  private readonly GRACE_PERIOD_DAYS = 7;

  constructor(private readonly billingService: BillingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const customer = request.customer;

    if (!customer) {
      throw new HttpException(
        'Customer not authenticated',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const isEmailRequest = request.url.includes('/email');
    if (isEmailRequest && customer.plan !== CustomerPlan.FREE) {
      return true;
    }

    const now = new Date();

    if (customer.usageResetAt < now) {
      await this.handleBillingCycleReset(customer, now);
    }

    const effectiveLimit = customer.customMonthlyLimit ?? customer.monthlyLimit;
    const { allowed, usage } = await this.billingService.consumeQuota(
      {
        id: customer.id,
        usageCount: customer.usageCount,
        billingCycleStartAt: customer.billingCycleStartAt,
        usageResetAt: customer.usageResetAt,
      },
      effectiveLimit,
    );

    if (!allowed) {
      this.logger.warn(
        `Usage limit exceeded for ${customer.email}: ${usage}/${effectiveLimit}`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        message: `Monthly usage limit exceeded (${usage}/${effectiveLimit}). Upgrade your plan or wait for reset on ${customer.usageResetAt.toLocaleDateString()}.`,
        error: 'Forbidden',
      });
    }

    customer.usageCount = usage;

    this.logger.debug(`Usage: ${customer.email} ${usage}/${effectiveLimit}`);

    return true;
  }

  private async handleBillingCycleReset(
    customer: AuthenticatedCustomer,
    now: Date,
  ): Promise<void> {
    const hash = customer.apiKeyHash;

    if (customer.plan === CustomerPlan.FREE) {
      const dates = await this.billingService.resetMonthlyUsage(
        customer.id,
        hash,
      );
      this.syncCustomerInMemory(customer, dates);

      this.logger.log(`Reset FREE plan customer: ${customer.email}`);
      return;
    }

    if (customer.providerSubscriptionId && customer.paymentProvider) {
      const cycle = await this.billingService.resolveProviderCycle(
        customer.providerSubscriptionId,
        customer.paymentProvider,
      );

      if (cycle.action === 'RENEWED') {
        const dates = await this.billingService.handleRenewalCharge(
          customer.id,
          cycle.periodEnd,
          hash,
        );
        if (dates) this.syncCustomerInMemory(customer, dates);
        this.logger.log(
          `Reconciled ${customer.plan} customer via provider: ${customer.email}`,
        );
        return;
      }

      if (cycle.action === 'LAPSED') {
        const dates = await this.billingService.downgradeToFreePlan(
          customer.id,
          'SUBSCRIPTION_EXPIRED',
          hash,
        );
        customer.plan = CustomerPlan.FREE;
        customer.monthlyLimit = getPlanLimit(CustomerPlan.FREE);
        this.syncCustomerInMemory(customer, dates);
        this.logger.warn(
          `Customer ${customer.email} downgraded to FREE (provider reports lapsed)`,
        );
        return;
      }

      if (cycle.action === 'ACTIVE') {
        const dates = await this.billingService.resetMonthlyUsage(
          customer.id,
          hash,
        );
        this.syncCustomerInMemory(customer, dates);
        this.logger.log(
          `Kept ${customer.plan} customer active (provider active, no period end): ${customer.email}`,
        );
        return;
      }
    }

    const hasActiveSubscription =
      customer.subscriptionStatus === SubscriptionStatus.ACTIVE &&
      customer.subscriptionEndDate &&
      customer.subscriptionEndDate > now;

    if (hasActiveSubscription) {
      const dates = await this.billingService.resetMonthlyUsage(
        customer.id,
        hash,
      );
      this.syncCustomerInMemory(customer, dates);

      this.logger.log(`Reset ${customer.plan} customer: ${customer.email}`);
      return;
    }

    const isInGracePeriod = this.checkGracePeriod(
      customer.subscriptionEndDate,
      now,
    );

    if (isInGracePeriod) {
      const dates = await this.billingService.resetMonthlyUsage(
        customer.id,
        hash,
      );
      this.syncCustomerInMemory(customer, dates);

      const daysLeft = this.getDaysLeft(customer.subscriptionEndDate, now);
      this.logger.warn(
        `Customer ${customer.email} in grace period (${daysLeft} days left)`,
      );
    } else {
      const dates = await this.billingService.downgradeToFreePlan(
        customer.id,
        'SUBSCRIPTION_EXPIRED',
        hash,
      );

      customer.plan = CustomerPlan.FREE;
      customer.monthlyLimit = getPlanLimit(CustomerPlan.FREE);
      this.syncCustomerInMemory(customer, dates);

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

  private syncCustomerInMemory(
    customer: AuthenticatedCustomer,
    dates: { billingCycleStartAt: Date; usageResetAt: Date },
  ): void {
    customer.usageCount = 0;
    customer.usageResetAt = dates.usageResetAt;
    customer.billingCycleStartAt = dates.billingCycleStartAt;
  }
}
