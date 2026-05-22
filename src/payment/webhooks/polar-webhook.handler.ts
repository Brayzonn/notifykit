import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateEvent } from '@polar-sh/sdk/webhooks';
import { BillingService } from '@/billing/billing.service';
import {
  CustomerPlan,
  PaymentProvider,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentWebhookEventService } from '../payment-webhook-event.service';
import { getErrorMessage } from '@/common/utils/error.util';

type PolarEvent = ReturnType<typeof validateEvent>;
type PolarSubscription = Extract<
  PolarEvent,
  { type: 'subscription.active' }
>['data'];

@Injectable()
export class PolarWebhookHandler {
  private readonly logger = new Logger(PolarWebhookHandler.name);
  private readonly webhookSecret: string;
  private readonly indiePlanId: string;
  private readonly startupPlanId: string;

  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly webhookEventLog: PaymentWebhookEventService,
  ) {
    this.webhookSecret =
      this.configService.getOrThrow<string>('POLAR_WEBHOOK_SECRET');
    this.indiePlanId =
      this.configService.get<string>('POLAR_INDIE_PRODUCT_ID') ?? '';
    this.startupPlanId =
      this.configService.get<string>('POLAR_STARTUP_PRODUCT_ID') ?? '';
  }

  async handle(rawBody: Buffer, headers: Record<string, string>) {
    let event: PolarEvent;
    try {
      event = validateEvent(rawBody, headers, this.webhookSecret);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`Processing Polar webhook: ${event.type}`);

    const dedupKey = `${event.type}:${(event.data as { id: string }).id}`;

    const isNew = await this.webhookEventLog.markProcessed(
      PaymentProvider.POLAR,
      dedupKey,
      event.type,
      event,
    );

    if (!isNew) {
      return { received: true, duplicate: true };
    }

    try {
      switch (event.type) {
        case 'subscription.active':
          await this.handleSubscriptionActive(event.data);
          break;
        case 'subscription.updated':
          await this.handleSubscriptionUpdated(event.data);
          break;
        case 'subscription.canceled':
          await this.handleSubscriptionCanceled(event.data);
          break;
        case 'subscription.revoked':
          await this.handleSubscriptionRevoked(event.data);
          break;
        case 'subscription.past_due':
          await this.handleSubscriptionPastDue(event.data);
          break;
        default:
          this.logger.log(`Unhandled Polar event type: ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      this.logger.error(
        `Error processing Polar webhook: ${getErrorMessage(error)}`,
        error,
      );
      await this.webhookEventLog.unmarkProcessed(
        PaymentProvider.POLAR,
        dedupKey,
      );
      throw error;
    }
  }

  private async handleSubscriptionActive(subscription: PolarSubscription) {
    const customerId = subscription.customer.externalId;
    if (!customerId) {
      this.logger.warn(
        `subscription.active missing externalId — subscriptionId: ${subscription.id}`,
      );
      return;
    }

    const plan = this.mapProductToPlan(subscription.productId);
    if (!plan) {
      this.logger.warn(
        `subscription.active unknown productId: ${subscription.productId}`,
      );
      return;
    }

    await this.billingService.handleSubscriptionActivated(customerId, {
      providerSubscriptionId: subscription.id,
      providerCustomerId: subscription.customerId,
      plan,
      paymentProvider: PaymentProvider.POLAR,
      nextBillingDate: subscription.currentPeriodEnd,
    });

    this.logger.log(
      `Polar subscription activated: customerId=${customerId} plan=${plan}`,
    );
  }

  private async handleSubscriptionUpdated(subscription: PolarSubscription) {
    if (subscription.status !== 'active' || subscription.cancelAtPeriodEnd) {
      this.logger.log(
        `subscription.updated skipped (status=${subscription.status} cancelAtPeriodEnd=${subscription.cancelAtPeriodEnd})`,
      );
      return;
    }

    const customer = await this.prisma.customer.findUnique({
      where: { providerSubscriptionId: subscription.id },
    });

    if (!customer) {
      this.logger.warn(
        `subscription.updated: no customer found for subscriptionId ${subscription.id}`,
      );
      return;
    }

    const newPlan = this.mapProductToPlan(subscription.productId);
    if (newPlan && newPlan !== customer.plan) {
      await this.billingService.handleSubscriptionActivated(customer.id, {
        providerSubscriptionId: subscription.id,
        providerCustomerId: subscription.customerId,
        plan: newPlan,
        paymentProvider: PaymentProvider.POLAR,
        nextBillingDate: subscription.currentPeriodEnd,
      });
      this.logger.log(
        `Polar plan upgrade: customer ${customer.email} → ${newPlan}`,
      );
      return;
    }

    await this.billingService.handleRenewalCharge(
      customer.id,
      subscription.currentPeriodEnd,
    );

    this.logger.log(`Polar renewal applied for customer ${customer.email}`);
  }

  private async handleSubscriptionCanceled(subscription: PolarSubscription) {
    await this.billingService.handleSubscriptionCancelled(subscription.id);
    this.logger.log(`Polar subscription canceled: ${subscription.id}`);
  }

  private async handleSubscriptionRevoked(subscription: PolarSubscription) {
    await this.billingService.handleSubscriptionExpired(subscription.id);
    this.logger.log(`Polar subscription revoked: ${subscription.id}`);
  }

  private async handleSubscriptionPastDue(subscription: PolarSubscription) {
    const customer = await this.prisma.customer.findUnique({
      where: { providerSubscriptionId: subscription.id },
    });

    if (!customer) {
      this.logger.warn(
        `subscription.past_due: no customer found for subscriptionId ${subscription.id}`,
      );
      return;
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { subscriptionStatus: SubscriptionStatus.PAST_DUE },
    });

    this.logger.warn(
      `Polar subscription past_due: customer ${customer.email}`,
    );
  }

  private mapProductToPlan(productId: string): CustomerPlan | null {
    if (productId === this.indiePlanId) return CustomerPlan.INDIE;
    if (productId === this.startupPlanId) return CustomerPlan.STARTUP;
    return null;
  }
}
