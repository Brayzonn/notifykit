import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BillingService } from '@/billing/billing.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { getErrorMessage } from '@/common/utils/error.util';
import {
  CustomerPlan,
  PaymentProvider,
  SubscriptionStatus,
} from '@prisma/client';
import { PaystackPaymentProvider } from '../providers/paystack-payment.provider';
import { QueueService } from '@/queues/queue.service';
import { PaymentWebhookEventService } from '../payment-webhook-event.service';

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
  private readonly indiePlanId: string;
  private readonly startupPlanId: string;

  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly paystackProvider: PaystackPaymentProvider,
    private readonly queueService: QueueService,
    private readonly webhookEventLog: PaymentWebhookEventService,
  ) {
    this.indiePlanId = this.configService.get<string>('PAYSTACK_INDIE_PLAN_ID') ?? '';
    this.startupPlanId = this.configService.get<string>('PAYSTACK_STARTUP_PLAN_ID') ?? '';
  }

  async handle(payload: Buffer, signature: string) {
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      throw new Error('PAYSTACK_SECRET_KEY not configured');
    }

    if (!this.verifySignature(payload, signature, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event: PaystackWebhookEvent = JSON.parse(payload.toString());
    this.logger.log(`Processing Paystack webhook: ${event.event}`);

    const dedupKey = this.buildDedupKey(event);
    if (dedupKey) {
      const isNew = await this.webhookEventLog.markProcessed(
        PaymentProvider.PAYSTACK,
        dedupKey,
        event.event,
        event,
      );
      if (!isNew) {
        return { received: true, duplicate: true };
      }
    }

    try {
      switch (event.event) {
        case 'charge.success':
          await this.handleChargeSuccess(event.data);
          break;

        case 'subscription.create':
          await this.handleSubscriptionCreate(event.data);
          break;

        case 'subscription.disable':
        case 'subscription.not_renew':
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
      this.logger.error(
        `Error processing webhook: ${getErrorMessage(error)}`,
        error,
      );
      if (dedupKey) {
        await this.webhookEventLog.unmarkProcessed(
          PaymentProvider.PAYSTACK,
          dedupKey,
        );
      }
      throw error;
    }
  }

  private verifySignature(
    payload: Buffer,
    signature: string,
    secret: string,
  ): boolean {
    const expected = crypto
      .createHmac('sha512', secret)
      .update(payload)
      .digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  }

  /**
   * Stable per-event identifier. Paystack doesn't ship a single canonical
   * `event_id`, so we synthesize one from the most-unique field available:
   * - `charge.success` / `invoice.*` → transaction `reference`
   * - `subscription.*` → `subscription_code` (combined with event type, since
   *   the same code generates multiple events across its lifecycle)
   * Returns null if we can't form a key — caller should let the event through
   * (no dedup) rather than block legitimate traffic.
   */
  private buildDedupKey(event: PaystackWebhookEvent): string | null {
    const ref = event.data?.reference;
    const subCode = event.data?.subscription_code;
    const txId = event.data?.id;

    if (ref) return `${event.event}:${ref}`;
    if (subCode) return `${event.event}:${subCode}`;
    if (txId != null) return `${event.event}:${txId}`;
    return null;
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

    const existingCustomer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!existingCustomer) {
      this.logger.warn(`Customer not found for charge.success: ${customerId}`);
      return;
    }

    const isRenewal =
      existingCustomer.subscriptionStatus === SubscriptionStatus.ACTIVE &&
      existingCustomer.plan === plan &&
      !!existingCustomer.providerSubscriptionId;

    if (isRenewal) {
      let nextBillingDate: Date | null = null;
      try {
        const sub = await this.paystackProvider.getSubscriptionByCode(
          existingCustomer.providerSubscriptionId!,
        );
        nextBillingDate = sub?.nextBillingDate ?? null;
      } catch (err) {
        this.logger.warn(
          `Renewal: failed to fetch fresh next_payment_date: ${getErrorMessage(err)}`,
        );
      }
      await this.billingService.handleRenewalCharge(
        existingCustomer.id,
        nextBillingDate,
      );
      this.logger.log(`Renewal processed for customer ${customerCode}`);
      return;
    }

    // Initial activation
    await this.billingService.handleSubscriptionActivated(customerId, {
      providerSubscriptionId: null,
      providerCustomerId: customerCode,
      plan,
      paymentProvider: PaymentProvider.PAYSTACK,
      nextBillingDate: null,
    });

    // Schedule a delayed back-fill (replaces fragile in-process setTimeout).
    // Idempotent — `subscription.create` arriving first will set
    // providerSubscriptionId and the delayed worker will short-circuit.
    await this.queueService.schedulePaystackSubscriptionLink({
      customerId,
      customerCode,
      customerNumericId,
      plan: plan as 'INDIE' | 'STARTUP',
    });

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

    const customer = await this.prisma.customer.findUnique({
      where: { providerCustomerId: customerCode },
    });

    if (!customer) {
      this.logger.warn(`Customer not found for customer code ${customerCode}`);
      return;
    }

    if (customer.providerSubscriptionId === subscriptionCode) {
      this.logger.log(
        `Subscription already linked for customer ${customer.email}, skipping`,
      );
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

  private async handleInvoicePaymentFailed(data: PaystackWebhookEvent['data']) {
    const subscriptionCode = data.subscription_code;

    if (!subscriptionCode) {
      this.logger.warn('No subscription code in invoice.payment_failed event');
      return;
    }

    const customer = await this.prisma.customer.findUnique({
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
        `Failed to send payment failed email: ${getErrorMessage(error)}`,
        error,
      );
    }
  }

  private mapPlanCodeToPlan(planCode: string): CustomerPlan | null {
    if (planCode === this.indiePlanId) return CustomerPlan.INDIE;
    if (planCode === this.startupPlanId) return CustomerPlan.STARTUP;
    return null;
  }
}
