import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentService } from '@/payment/payment.service';
import { CustomerPlan, SubscriptionStatus } from '@prisma/client';
import { PLAN_LIMITS } from '@/common/constants/plans.constants';
import { getPlanLimit } from '@/common/constants/plans.constants';
import {
  CancelSubscriptionResponse,
  CreateCheckoutResponse,
  InvoicesResponse,
  SubscriptionDetailsResponse,
} from '@/billing/interfaces/billing.interface';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
  ) {}

  async createUpgradeCheckout(
    userId: string,
    targetPlan: CustomerPlan,
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
        usageResetAt:
          subscriptionData.nextBillingDate ??
          new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
        billingCycleStartAt: now,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        paymentProvider: subscriptionData.paymentProvider as any,
        providerCustomerId: subscriptionData.providerCustomerId,
        providerSubscriptionId: subscriptionData.providerSubscriptionId,
        nextBillingDate: subscriptionData.nextBillingDate,
        lastPaymentDate: now,
      },
    });
  }

  async handleSubscriptionCancelled(subscriptionId: string) {
    const customer = await this.prisma.customer.findFirst({
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
      },
    });

    this.logger.log(`Subscription ${subscriptionId} marked as cancelled`);
  }

  async handleSubscriptionExpired(subscriptionId: string) {
    const customer = await this.prisma.customer.findFirst({
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

  /**
   * downgrade customer to free plan
   */
  async downgradeToFreePlan(
    customerId: string,
    reason: 'SUBSCRIPTION_EXPIRED' | 'PAYMENT_FAILED',
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { plan: true, email: true },
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

    //do later-------send user downgrade email--------------------------------------

    this.logger.warn(
      `Customer ${customer.email} downgraded from ${originalPlan} to FREE. Next reset: ${resetDate.toISOString()}`,
    );
  }

  /**
   * Reset customer usage for new billing cycle
   */
  async resetMonthlyUsage(customerId: string): Promise<void> {
    const resetDate = new Date();
    resetDate.setDate(resetDate.getDate() + 30); // 30 days from now

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        usageCount: 0,
        usageResetAt: resetDate,
        billingCycleStartAt: new Date(),
      },
    });

    this.logger.log(
      `Reset usage for customer ${customerId}. Next reset: ${resetDate.toISOString()}`,
    );
  }

  /**
   * Increment usage counter
   */
  async incrementUsage(customerId: string): Promise<void> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { usageCount: { increment: 1 } },
    });
  }
}
