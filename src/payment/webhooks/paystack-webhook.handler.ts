import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { BillingService } from '@/billing/billing.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import {
  CustomerPlan,
  PaymentProvider,
  SubscriptionStatus,
} from '@prisma/client';
import { PaystackPaymentProvider } from '../providers/paystack-payment.provider';

interface PaystackWebhookEvent {
  event: string;
  data: {
    id?: number;
    domain?: string;
    reference?: string;
    amount?: number;
    message?: string | null;
    gateway_response?: string;
    paid_at?: string;
    created_at?: string;
    channel?: string;
    currency?: string;
    ip_address?: string;
    fees?: number;
    fees_split?: any;
    paidAt?: string;
    requested_amount?: number;
    status?: string;
    metadata?: {
      customerId?: string;
      plan?: CustomerPlan;
      cancel_action?: string;
      referrer?: string;
    };
    source?: {
      type?: string;
      source?: string;
      entry_point?: string;
      identifier?: string | null;
    };

    subscription_code?: string;
    next_payment_date?: string;
    cron_expression?: string;
    open_invoice?: any;

    customer?: {
      id?: number;
      email: string;
      customer_code: string;
      first_name?: string | null;
      last_name?: string | null;
      phone?: string | null;
      metadata?: any;
      risk_action?: string;
      international_format_phone?: string | null;
    };
    plan?: {
      id?: number;
      plan_code: string;
      name: string;
      description?: string | null;
      amount?: number;
      interval?: string;
      send_invoices?: number | boolean;
      send_sms?: number | boolean;
      currency?: string;
    };
    authorization?: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      channel?: string;
      card_type?: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable?: boolean;
      signature?: string;
      account_name?: string | null;
      receiver_bank_account_number?: string | null;
      receiver_bank?: string | null;
    };

    subscription?: {
      subscription_code: string;
    };
  };
}

@Injectable()
export class PaystackWebhookHandler {
  private readonly logger = new Logger(PaystackWebhookHandler.name);
  private readonly paystackUrl = 'https://api.paystack.co';

  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly httpService: HttpService,
    private readonly paystackProvider: PaystackPaymentProvider,
  ) {}

  async handle(payload: Buffer, signature: string) {
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      throw new Error('PAYSTACK_SECRET_KEY not configured');
    }

    const hash = crypto
      .createHmac('sha512', secret)
      .update(payload)
      .digest('hex');

    if (hash !== signature) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event: PaystackWebhookEvent = JSON.parse(payload.toString());
    this.logger.log(`Processing Paystack webhook: ${event.event}`);

    try {
      switch (event.event) {
        case 'charge.success':
          await this.handleChargeSuccess(event.data);
          break;

        case 'subscription.create':
          await this.handleSubscriptionCreate(event.data);
          break;

        case 'subscription.disable':
          await this.handleSubscriptionDisable(event.data);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data);
          break;

        default:
          this.logger.log(`Unhandled Paystack event type: ${event.event}`);
      }

      return { received: true };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`, error);
      throw error;
    }
  }

  private async handleChargeSuccess(data: PaystackWebhookEvent['data']) {
    const customerId = data.metadata?.customerId;
    const plan = data.metadata?.plan;
    const customerCode = data.customer?.customer_code;
    const customerNumericId = data.customer?.id;
    const planCode = data.plan?.plan_code;

    if (!customerId || !plan || !customerCode || !planCode) {
      this.logger.log(
        `Payment received without subscription metadata: ${data.reference}`,
      );
      return;
    }

    const existingCustomer = await this.prisma.customer.findFirst({
      where: { id: customerId },
    });

    if (
      existingCustomer?.subscriptionStatus === SubscriptionStatus.ACTIVE &&
      existingCustomer?.plan === plan
    ) {
      this.logger.log(`Customer ${customerId} already on ${plan}, skipping`);
      return;
    }

    await this.billingService.handleSubscriptionActivated(customerId, {
      providerSubscriptionId: null,
      providerCustomerId: customerCode,
      plan,
      paymentProvider: PaymentProvider.PAYSTACK,
      nextBillingDate: null,
    });

    setTimeout(async () => {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId },
      });
      if (!customer?.providerSubscriptionId) {
        this.logger.warn(
          `subscription.create never fired for ${customerId}, fetching manually`,
        );
        await this.fetchAndLinkSubscription(
          customerId,
          customerCode,
          plan,
          customerNumericId,
        );
      }
    }, 10000);

    this.logger.log(
      `Access provisioned for customer ${customerCode} via charge.success`,
    );
  }

  private async handleSubscriptionCreate(data: PaystackWebhookEvent['data']) {
    const subscriptionCode = data.subscription_code;
    const customerCode = data.customer?.customer_code;
    const planCode = data.plan?.plan_code;

    if (!subscriptionCode || !customerCode || !planCode) {
      this.logger.warn('Missing required data in subscription.create event');
      return;
    }

    const plan = this.mapPlanCodeToPlan(planCode);
    if (!plan) {
      this.logger.warn(`Unknown plan code: ${planCode}`);
      return;
    }

    const customer = await this.prisma.customer.findFirst({
      where: { providerCustomerId: customerCode },
    });

    if (!customer) {
      this.logger.warn(`Customer not found for customer code ${customerCode}`);
      return;
    }

    if (!data.next_payment_date) {
      this.logger.warn('No next_payment_date in subscription.create event');
      return;
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        providerSubscriptionId: subscriptionCode,
        nextBillingDate: new Date(data.next_payment_date),
        subscriptionEndDate: new Date(data.next_payment_date),
      },
    });

    this.logger.log(
      `Subscription code and billing date linked for customer ${customer.email}`,
    );
  }

  private async handleSubscriptionDisable(data: PaystackWebhookEvent['data']) {
    const subscriptionCode = data.subscription_code;

    if (!subscriptionCode) {
      this.logger.warn('No subscription code in subscription.disable event');
      return;
    }

    await this.billingService.handleSubscriptionCancelled(subscriptionCode);
    this.logger.log(`Subscription disabled: ${subscriptionCode}`);
  }

  private async fetchAndLinkSubscription(
    customerId: string,
    customerCode: string,
    plan: CustomerPlan,
    customerNumericId?: number,
  ) {
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    const query = customerNumericId ?? customerCode;

    const response = await firstValueFrom(
      this.httpService.get(
        `${this.paystackUrl}/subscription?customer=${query}`,
        { headers: { Authorization: `Bearer ${secret}` } },
      ),
    );

    const subscriptions = response.data?.data || [];

    this.logger.log(
      `Found ${subscriptions.length} subscriptions for customer ${customerCode}`,
    );

    const planCode = this.paystackProvider.getPlanCode(plan);

    const active = subscriptions.find(
      (s: any) => s.status === 'active' && s.plan.plan_code === planCode,
    );
    if (!active) {
      this.logger.error(
        `No subscription found for customer ${customerId} after 10s`,
      );
      return;
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        providerSubscriptionId: active.subscription_code,
        nextBillingDate: new Date(active.next_payment_date),
        subscriptionEndDate: new Date(active.next_payment_date),
        usageResetAt: new Date(active.next_payment_date),
      },
    });

    this.logger.log(`Manually linked subscription for customer ${customerId}`);
  }

  private async handleInvoicePaymentFailed(data: PaystackWebhookEvent['data']) {
    const subscriptionCode = data.subscription_code;

    if (!subscriptionCode) {
      this.logger.warn('No subscription code in invoice.payment_failed event');
      return;
    }

    const customer = await this.prisma.customer.findFirst({
      where: { providerSubscriptionId: subscriptionCode },
    });

    if (!customer) {
      this.logger.warn(
        `Customer not found for subscription ${subscriptionCode}`,
      );
      return;
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
      },
    });

    this.logger.warn(
      `Payment failed for customer ${customer.email}. Subscription ${subscriptionCode} marked as PAST_DUE`,
    );

    try {
      await this.emailService.sendPaymentFailedEmail({
        email: customer.email,
        name: customer.email.split('@')[0],
        plan: customer.plan,
        amount: data.amount ? data.amount / 100 : 0,
        retryDate: null,
      });

      this.logger.log(`Payment failed email sent to ${customer.email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send payment failed email: ${error.message}`,
        error,
      );
    }
  }

  private mapPlanCodeToPlan(planCode: string): CustomerPlan | null {
    const indiePlanId = this.configService.get('PAYSTACK_INDIE_PLAN_ID');
    const startupPlanId = this.configService.get('PAYSTACK_STARTUP_PLAN_ID');

    if (planCode === indiePlanId) {
      return CustomerPlan.INDIE;
    }
    if (planCode === startupPlanId) {
      return CustomerPlan.STARTUP;
    }

    return null;
  }
}
