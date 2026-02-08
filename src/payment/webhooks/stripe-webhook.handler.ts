import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from '@/billing/billing.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import {
  CustomerPlan,
  PaymentProvider,
  SubscriptionStatus,
} from '@prisma/client';
import Stripe from 'stripe';

@Injectable()
export class StripeWebhookHandler {
  private readonly logger = new Logger(StripeWebhookHandler.name);
  private readonly stripe: Stripe | null = null;

  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (stripeKey) {
      this.stripe = new Stripe(stripeKey);
    }
  }

  async handle(payload: Buffer, signature: string) {
    if (!this.stripe) {
      throw new Error('Stripe not configured');
    }

    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    }

    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret,
    );
    this.logger.log(`Processing Stripe webhook: ${event.type}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`, error);
      throw error;
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const customerId = session.metadata?.customerId;
    const plan = session.metadata?.plan as CustomerPlan;

    if (!customerId || !plan) {
      this.logger.warn('Missing metadata in checkout session');
      return;
    }

    if (!session.subscription || typeof session.subscription !== 'string') {
      this.logger.warn('No subscription in checkout session');
      return;
    }

    const subscription = await this.getSubscription(session.subscription);

    if (!subscription || !subscription.items?.data?.[0]) {
      this.logger.error(
        'Failed to retrieve subscription or subscription items',
      );
      return;
    }

    const subscriptionItem = subscription.items.data[0];
    const currentPeriodEnd = subscriptionItem.current_period_end;

    await this.billingService.handleSubscriptionActivated(customerId, {
      providerSubscriptionId: subscription.id,
      providerCustomerId:
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id,
      plan,
      paymentProvider: PaymentProvider.STRIPE,
      nextBillingDate: new Date(currentPeriodEnd * 1000),
    });

    this.logger.log(`Checkout completed for customer ${customerId}`);
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    this.logger.log(`Subscription updated: ${subscription.id}`);

    const customer = await this.prisma.customer.findFirst({
      where: { providerSubscriptionId: subscription.id },
    });

    if (!customer) {
      this.logger.warn(
        `Customer not found for subscription ${subscription.id}`,
      );
      return;
    }

    const subscriptionItem = subscription.items.data[0];
    if (!subscriptionItem) {
      this.logger.warn(`No subscription items found for ${subscription.id}`);
      return;
    }

    const currentPeriodEnd = subscriptionItem.current_period_end;

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        nextBillingDate: new Date(currentPeriodEnd * 1000),
      },
    });

    this.logger.log(
      `Updated subscription for customer ${customer.email}. Next billing: ${new Date(currentPeriodEnd * 1000).toISOString()}`,
    );
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    await this.billingService.handleSubscriptionCancelled(subscription.id);
    this.logger.log(`Subscription deleted: ${subscription.id}`);
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice) {
    const subscriptionId = invoice.parent?.subscription_details?.subscription;

    if (!subscriptionId || typeof subscriptionId !== 'string') return;

    const customer = await this.prisma.customer.findFirst({
      where: { providerSubscriptionId: subscriptionId },
    });

    if (customer) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { lastPaymentDate: new Date() },
      });

      this.logger.log(`Payment succeeded for customer ${customer.email}`);
    }
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice) {
    const subscriptionId = invoice.parent?.subscription_details?.subscription;

    if (!subscriptionId || typeof subscriptionId !== 'string') return;

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
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
      },
    });

    this.logger.warn(
      `Payment failed for customer ${customer.email}. Subscription ${subscriptionId} marked as PAST_DUE`,
    );

    try {
      const retryDate = invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000)
        : null;

      await this.emailService.sendPaymentFailedEmail({
        email: customer.email,
        name: customer.email.split('@')[0],
        plan: customer.plan,
        amount: invoice.amount_due / 100,
        retryDate,
      });

      this.logger.log(`Payment failed email sent to ${customer.email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send payment failed email: ${error.message}`,
        error,
      );
    }
  }

  private async getSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription | null> {
    if (!this.stripe) {
      this.logger.error('Stripe not configured');
      return null;
    }

    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId,
        {
          expand: ['customer'],
        },
      );
      return subscription;
    } catch (error) {
      this.logger.error(`Failed to retrieve subscription: ${error.message}`);
      return null;
    }
  }
}
