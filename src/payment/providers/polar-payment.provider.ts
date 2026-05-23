import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Polar } from '@polar-sh/sdk';
import { PaymentProvider } from './payment-provider.interface';
import { CheckoutSessionRequest } from '@/billing/interfaces/billing.interface';
import { getErrorMessage } from '@/common/utils/error.util';

@Injectable()
export class PolarPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(PolarPaymentProvider.name);
  private readonly polar: Polar;
  private readonly accessToken: string;
  private readonly indiePlanId: string;
  private readonly startupPlanId: string;

  constructor(private readonly configService: ConfigService) {
    this.accessToken =
      this.configService.get<string>('POLAR_ACCESS_TOKEN') || '';
    this.indiePlanId =
      this.configService.get<string>('POLAR_INDIE_PRODUCT_ID') ?? '';
    this.startupPlanId =
      this.configService.get<string>('POLAR_STARTUP_PRODUCT_ID') ?? '';
    const server =
      this.configService.get<string>('POLAR_SERVER') === 'production'
        ? 'production'
        : 'sandbox';

    if (!this.accessToken) {
      this.logger.warn('POLAR_ACCESS_TOKEN not configured');
    }

    this.polar = new Polar({
      accessToken: this.accessToken,
      server,
    });
  }

  async createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<string | null> {
    if (!this.accessToken) {
      throw new InternalServerErrorException('Polar not configured');
    }

    if (request.providerSubscriptionId) {
      return this.upgradeSubscription(
        request.providerSubscriptionId,
        request.plan,
      );
    }

    try {
      const productId = this.getProductId(request.plan);
      const frontendUrl = (this.configService.get<string>('FRONTEND_URL') ?? '').split(',')[0].trim();
      const successUrl = `${frontendUrl}/user/dashboard/usage?success=true`;

      const checkout = await this.polar.checkouts.create({
        products: [productId],
        externalCustomerId: request.customerId,
        customerEmail: request.customerEmail,
        successUrl,
      });

      if (!checkout?.url) {
        throw new InternalServerErrorException(
          'Polar checkout URL not generated',
        );
      }

      return checkout.url;
    } catch (error) {
      this.logger.error(
        `Failed to create Polar checkout: ${getErrorMessage(error)}`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to create checkout session',
      );
    }
  }

  private async upgradeSubscription(
    subscriptionId: string,
    targetPlan: string,
  ): Promise<null> {
    try {
      const productId = this.getProductId(targetPlan);
      await this.polar.subscriptions.update({
        id: subscriptionId,
        subscriptionUpdate: { productId, prorationBehavior: 'invoice' },
      });
      this.logger.log(
        `Polar subscription ${subscriptionId} upgraded to ${targetPlan}`,
      );
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to upgrade Polar subscription: ${getErrorMessage(error)}`,
        error,
      );
      throw new InternalServerErrorException('Failed to upgrade subscription');
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!this.accessToken) {
      throw new InternalServerErrorException('Polar not configured');
    }

    try {
      await this.polar.subscriptions.update({
        id: subscriptionId,
        subscriptionUpdate: {
          cancelAtPeriodEnd: true,
        },
      });

      this.logger.log(
        `Polar subscription ${subscriptionId} marked to cancel at period end`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to cancel Polar subscription: ${getErrorMessage(error)}`,
        error,
      );
      throw new InternalServerErrorException('Failed to cancel subscription');
    }
  }

  async getInvoices(providerCustomerId: string): Promise<any[]> {
    if (!this.accessToken) {
      throw new InternalServerErrorException('Polar not configured');
    }

    try {
      const response = await this.polar.orders.list({
        externalCustomerId: providerCustomerId,
      });

      const orders = response.result.items ?? [];

      return orders.map((order) => ({
        id: order.id,
        amount: order.totalAmount,
        currency: order.currency,
        status: order.status,
        date: new Date(order.createdAt),
        pdfUrl: null,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch Polar orders: ${getErrorMessage(error)}`,
        error,
      );
      throw new InternalServerErrorException('Failed to fetch invoices');
    }
  }

  private getProductId(plan: string): string {
    const productIds: Record<string, string | undefined> = {
      INDIE: this.indiePlanId,
      STARTUP: this.startupPlanId,
    };

    const productId = productIds[plan];
    if (!productId) {
      throw new BadRequestException(
        `No Polar product ID configured for plan: ${plan}`,
      );
    }

    return productId;
  }
}
