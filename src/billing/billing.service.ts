import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentService } from '@/payment/payment.service';
import {
  CustomerPlan,
  PaymentProvider,
  SubscriptionStatus,
} from '@prisma/client';
import { PLAN_LIMITS } from '@/common/constants/plans.constants';
import { getPlanLimit } from '@/common/constants/plans.constants';
import {
  CancelSubscriptionResponse,
  CreateCheckoutResponse,
  Currency,
  InvoicesResponse,
  ProviderCycleResolution,
  SubscriptionDetailsResponse,
} from '@/billing/interfaces/billing.interface';
import { RedisService } from '@/redis/redis.service';
import { getErrorMessage } from '@/common/utils/error.util';
import { addMonths } from '@/common/utils/date.util';
import { EmailService } from '@/platform-email/email.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly USAGE_FLUSH_INTERVAL = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
    private readonly redis: RedisService,
    private readonly emailService: EmailService,
  ) {}

  async createUpgradeCheckout(
    userId: string,
    targetPlan: CustomerPlan,
    currency: Currency,
  ): Promise<CreateCheckoutResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === targetPlan) {
      throw new BadRequestException('Already on this plan');
    }

    if (
      customer.subscriptionStatus === SubscriptionStatus.CANCELLED &&
      customer.subscriptionEndDate &&
      customer.subscriptionEndDate < new Date()
    ) {
      await this.downgradeToFreePlan(customer.id, 'SUBSCRIPTION_EXPIRED');
      customer.plan = CustomerPlan.FREE;
      customer.subscriptionStatus = SubscriptionStatus.EXPIRED;
    }

    if (
      customer.subscriptionStatus === SubscriptionStatus.ACTIVE &&
      customer.paymentProvider !== null &&
      customer.paymentProvider !== this.getProviderForCurrency(currency)
    ) {
      throw new BadRequestException(
        'You have an active subscription on a different billing method. Please cancel it before switching.',
      );
    }

    if (this.isDowngrade(customer.plan, targetPlan)) {
      const canDowngrade =
        customer.subscriptionStatus === SubscriptionStatus.EXPIRED ||
        customer.subscriptionStatus === SubscriptionStatus.PAST_DUE;

      if (!canDowngrade) {
        const message =
          customer.subscriptionStatus === SubscriptionStatus.CANCELLED
            ? 'Please wait until your current subscription expires before subscribing to a lower plan'
            : 'Please cancel current subscription to downgrade';

        throw new BadRequestException(message);
      }
    }

    const checkoutUrl = await this.paymentService.createCheckoutSession({
      customerId: customer.id,
      customerEmail: customer.email,
      plan: targetPlan,
      currentPlan: customer.plan,
      currency,
      providerSubscriptionId:
        customer.paymentProvider === PaymentProvider.POLAR &&
        customer.subscriptionStatus === SubscriptionStatus.ACTIVE
          ? customer.providerSubscriptionId
          : null,
    });

    return {
      checkoutUrl,
      plan: targetPlan,
      price: PLAN_LIMITS[targetPlan].price,
    };
  }

  async cancelSubscription(
    userId: string,
    reason?: string,
  ): Promise<CancelSubscriptionResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === CustomerPlan.FREE) {
      throw new BadRequestException('No active subscription to cancel');
    }

    if (!customer.providerSubscriptionId) {
      throw new BadRequestException('No subscription found');
    }

    if (!customer.paymentProvider) {
      throw new BadRequestException('No payment provider found');
    }

    await this.paymentService.cancelSubscription(
      customer.providerSubscriptionId,
    );

    const updatedCustomer = await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        subscriptionStatus: SubscriptionStatus.CANCELLED,
        previousPlan: customer.plan,
        downgradedAt: new Date(),
        nextBillingDate: null,
        subscriptionEndDate: customer.nextBillingDate,
      },
    });

    this.logger.log(
      `Subscription cancelled for customer ${customer.id}. Reason: ${reason || 'Not provided'}`,
    );

    return {
      message: 'Subscription cancelled successfully',
      effectiveUntil: updatedCustomer.subscriptionEndDate,
    };
  }

  async getSubscriptionDetails(
    userId: string,
  ): Promise<SubscriptionDetailsResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return {
      plan: customer.plan,
      status: customer.subscriptionStatus,
      nextBillingDate: customer.nextBillingDate,
      subscriptionEndDate: customer.subscriptionEndDate,
      paymentProvider: customer.paymentProvider,
      monthlyLimit: customer.monthlyLimit,
    };
  }

  async getInvoices(userId: string): Promise<InvoicesResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (!customer.providerCustomerId || !customer.paymentProvider) {
      return { invoices: [] };
    }

    const invoices = await this.paymentService.getInvoices(
      customer.providerCustomerId,
      customer.paymentProvider,
    );

    return { invoices };
  }

  async handleSubscriptionActivated(
    customerId: string,
    subscriptionData: {
      providerSubscriptionId: string | null;
      providerCustomerId: string;
      plan: CustomerPlan;
      paymentProvider: string;
      nextBillingDate: Date | null;
    },
  ) {
    const now = new Date();

    const currentCustomer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!currentCustomer) {
      throw new NotFoundException('Customer not found');
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        plan: subscriptionData.plan,
        monthlyLimit: PLAN_LIMITS[subscriptionData.plan].monthlyLimit,
        usageCount: 0,
        usageResetAt: subscriptionData.nextBillingDate ?? addMonths(now, 1),
        billingCycleStartAt: now,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        paymentProvider: subscriptionData.paymentProvider as any,
        providerCustomerId: subscriptionData.providerCustomerId,
        ...(subscriptionData.providerSubscriptionId !== null && {
          providerSubscriptionId: subscriptionData.providerSubscriptionId,
        }),
        nextBillingDate: subscriptionData.nextBillingDate,
        lastPaymentDate: now,
      },
    });

    await this.redis.del(`user:${currentCustomer.userId}`);
  }

  async handleRenewalCharge(
    customerId: string,
    nextBillingDate: Date | null,
    apiKeyHash?: string,
  ): Promise<{ billingCycleStartAt: Date; usageResetAt: Date } | null> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, userId: true, email: true },
    });

    if (!customer) {
      this.logger.warn(`Renewal: customer ${customerId} not found`);
      return null;
    }

    const now = new Date();
    const effectiveNext = nextBillingDate ?? addMonths(now, 1);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        lastPaymentDate: now,
        nextBillingDate: effectiveNext,
        subscriptionEndDate: effectiveNext,
        usageResetAt: effectiveNext,
        billingCycleStartAt: now,
        usageCount: 0,
      },
    });

    await this.redis.del(`user:${customer.userId}`);
    await this.invalidateApiKeyCache(apiKeyHash);

    this.logger.log(
      `Renewal applied for ${customer.email}; next billing ${effectiveNext.toISOString()}`,
    );

    return { billingCycleStartAt: now, usageResetAt: effectiveNext };
  }

  async resolveProviderCycle(
    providerSubscriptionId: string,
    paymentProvider: string,
  ): Promise<ProviderCycleResolution> {
    try {
      const sub = await this.paymentService.getSubscriptionStatus(
        providerSubscriptionId,
        paymentProvider,
      );

      if (!sub) return { action: 'UNKNOWN' };

      if (!sub.isActive) return { action: 'LAPSED' };

      if (sub.currentPeriodEnd && sub.currentPeriodEnd > new Date()) {
        return { action: 'RENEWED', periodEnd: sub.currentPeriodEnd };
      }

      return { action: 'ACTIVE' };
    } catch (error) {
      this.logger.warn(
        `resolveProviderCycle failed for ${providerSubscriptionId}: ${getErrorMessage(error)}`,
      );
      return { action: 'UNKNOWN' };
    }
  }

  private async invalidateApiKeyCache(apiKeyHash?: string): Promise<void> {
    if (apiKeyHash) await this.redis.del(`apikey:${apiKeyHash}`);
  }

  async handleSubscriptionCancelled(subscriptionId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { providerSubscriptionId: subscriptionId },
    });

    if (!customer) {
      this.logger.warn(`Customer not found for subscription ${subscriptionId}`);
      return;
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        subscriptionStatus: SubscriptionStatus.CANCELLED,
        subscriptionEndDate:
          customer.nextBillingDate ?? customer.subscriptionEndDate,
      },
    });

    this.logger.log(`Subscription ${subscriptionId} marked as cancelled`);
  }

  async handleSubscriptionExpired(subscriptionId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { providerSubscriptionId: subscriptionId },
    });

    if (!customer) {
      this.logger.warn(`Customer not found for subscription ${subscriptionId}`);
      return;
    }

    const now = new Date();
    const resetDate = new Date(now);
    resetDate.setDate(resetDate.getDate() + 30);

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        plan: CustomerPlan.FREE,
        monthlyLimit: PLAN_LIMITS[CustomerPlan.FREE].monthlyLimit,
        usageCount: 0,
        usageResetAt: resetDate,
        billingCycleStartAt: now,
        previousPlan: customer.plan,
        downgradedAt: now,
        subscriptionStatus: SubscriptionStatus.EXPIRED,
      },
    });

    this.logger.warn(
      `Customer ${customer.email} downgraded to FREE due to expired subscription`,
    );
  }

  private getProviderForCurrency(currency: Currency): PaymentProvider {
    return currency === 'USD'
      ? PaymentProvider.POLAR
      : PaymentProvider.PAYSTACK;
  }

  private isDowngrade(
    currentPlan: CustomerPlan,
    targetPlan: CustomerPlan,
  ): boolean {
    const planHierarchy = {
      [CustomerPlan.FREE]: 0,
      [CustomerPlan.INDIE]: 1,
      [CustomerPlan.STARTUP]: 2,
    };

    return planHierarchy[targetPlan] < planHierarchy[currentPlan];
  }

  async downgradeToFreePlan(
    customerId: string,
    reason: 'SUBSCRIPTION_EXPIRED' | 'PAYMENT_FAILED',
    apiKeyHash?: string,
  ): Promise<{ billingCycleStartAt: Date; usageResetAt: Date }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { plan: true, email: true, user: { select: { name: true } } },
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    const originalPlan = customer.plan;
    const now = new Date();

    const resetDate = new Date(now);
    resetDate.setDate(resetDate.getDate() + 30);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        plan: CustomerPlan.FREE,
        monthlyLimit: getPlanLimit(CustomerPlan.FREE),
        usageCount: 0,
        usageResetAt: resetDate,
        billingCycleStartAt: now,
        previousPlan: originalPlan,
        downgradedAt: now,
        subscriptionStatus: SubscriptionStatus.EXPIRED,
      },
    });

    await this.invalidateApiKeyCache(apiKeyHash);

    try {
      await this.emailService.sendPlanDowngradedEmail({
        email: customer.email,
        name: customer.user?.name ?? 'there',
        previousPlan: originalPlan,
        reason,
        resetDate,
      });
    } catch (error) {
      this.logger.error(
        `Failed to queue downgrade email for ${customer.email}: ${getErrorMessage(error)}`,
      );
    }

    return { billingCycleStartAt: now, usageResetAt: resetDate };
  }

  async resetMonthlyUsage(
    customerId: string,
    apiKeyHash?: string,
  ): Promise<{ billingCycleStartAt: Date; usageResetAt: Date }> {
    const now = new Date();
    const resetDate = new Date(now);
    resetDate.setDate(resetDate.getDate() + 30);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        usageCount: 0,
        usageResetAt: resetDate,
        billingCycleStartAt: now,
      },
    });

    await this.invalidateApiKeyCache(apiKeyHash);

    this.logger.log(
      `Reset usage for customer ${customerId}. Next reset: ${resetDate.toISOString()}`,
    );

    return { billingCycleStartAt: now, usageResetAt: resetDate };
  }

  async consumeQuota(
    customer: {
      id: string;
      usageCount?: number;
      billingCycleStartAt: Date;
      usageResetAt: Date;
    },
    limit: number,
  ): Promise<{ allowed: boolean; usage: number }> {
    const key = `usage:${customer.id}:${customer.billingCycleStartAt.getTime()}`;
    const baseline = customer.usageCount ?? 0;
    const ttlSeconds = Math.min(
      Math.max(
        60,
        Math.ceil((customer.usageResetAt.getTime() - Date.now()) / 1000),
      ),
      40 * 24 * 60 * 60,
    );

    const script = `
      local key = KEYS[1]
      local baseline = tonumber(ARGV[1])
      local limit = tonumber(ARGV[2])
      local ttl = tonumber(ARGV[3])
      if redis.call('EXISTS', key) == 0 then
        redis.call('SET', key, baseline, 'EX', ttl)
      end
      local current = tonumber(redis.call('GET', key))
      if current >= limit then
        return -1
      end
      return redis.call('INCR', key)
    `;

    let result: number;
    try {
      const client = this.redis.getClient();
      result = Number(
        await client.eval(
          script,
          1,
          key,
          String(baseline),
          String(limit),
          String(ttlSeconds),
        ),
      );
    } catch (error) {
      this.logger.error(`consumeQuota Redis error: ${getErrorMessage(error)}`);
      if (baseline >= limit) {
        return { allowed: false, usage: baseline };
      }
      await this.incrementUsage(customer.id);
      return { allowed: true, usage: baseline + 1 };
    }

    if (result === -1) {
      return { allowed: false, usage: baseline };
    }

    if (result % this.USAGE_FLUSH_INTERVAL === 0) {
      this.flushUsage(customer.id, result);
    }

    return { allowed: true, usage: result };
  }

  private flushUsage(customerId: string, usage: number): void {
    this.prisma.customer
      .update({ where: { id: customerId }, data: { usageCount: usage } })
      .catch((error) =>
        this.logger.error(
          `Failed to flush usage for ${customerId}: ${getErrorMessage(error)}`,
        ),
      );
  }

  async incrementUsage(customerId: string): Promise<void> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { usageCount: { increment: 1 } },
    });
  }
}
