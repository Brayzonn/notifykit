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

    if (this.isDowngrade(customer.plan, targetPlan)) {
      throw new BadRequestException(
        'Please cancel current subscription to downgrade',
      );
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
      customer.paymentProvider,
    );

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        subscriptionStatus: SubscriptionStatus.CANCELLED,
        previousPlan: customer.plan,
        downgradedAt: new Date(),
      },
    });

    this.logger.log(
      `Subscription cancelled for customer ${customer.id}. Reason: ${reason || 'Not provided'}`,
    );

    return {
      message: 'Subscription cancelled successfully',
      effectiveUntil: customer.subscriptionEndDate,
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

    // Fetch from Stripe
    if (customer.paymentProvider === PaymentProvider.STRIPE) {
      const stripeInvoices = await this.paymentService.getStripeInvoices(
        customer.providerCustomerId,
      );

      return {
        invoices: stripeInvoices.map((inv) => ({
          id: inv.id,
          amount: inv.amount_paid / 100, // cents to dollars
          currency: inv.currency,
          status: inv.status,
          date: new Date(inv.created * 1000),
          pdfUrl: inv.invoice_pdf,
        })),
      };
    }

    // Fetch from Paystack
    if (customer.paymentProvider === PaymentProvider.PAYSTACK) {
      const paystackInvoices = await this.paymentService.getPaystackInvoices(
        customer.providerCustomerId,
      );

      return {
        invoices: paystackInvoices.map((inv) => ({
          id: inv.id,
          amount: inv.amount / 100,
          currency: inv.currency,
          status: inv.status,
          date: new Date(inv.created_at),
          pdfUrl: inv.receipt_url,
        })),
      };
    }

    return { invoices: [] };
  }

  async handleSubscriptionActivated(
    customerId: string,
    subscriptionData: {
      providerSubscriptionId: string;
      providerCustomerId: string;
      plan: CustomerPlan;
      paymentProvider: string;
      nextBillingDate: Date;
    },
  ) {
    const now = new Date();
    const resetDate = new Date(now);
    resetDate.setDate(resetDate.getDate() + 30);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        plan: subscriptionData.plan,
        monthlyLimit: PLAN_LIMITS[subscriptionData.plan].monthlyLimit,
        usageCount: 0,
        usageResetAt: resetDate,
        billingCycleStartAt: now,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        paymentProvider: subscriptionData.paymentProvider as any,
        providerCustomerId: subscriptionData.providerCustomerId,
        providerSubscriptionId: subscriptionData.providerSubscriptionId,
        nextBillingDate: subscriptionData.nextBillingDate,
        lastPaymentDate: now,
      },
    });

    this.logger.log(
      `Subscription activated for customer ${customerId} on ${subscriptionData.plan} plan`,
    );
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
}
