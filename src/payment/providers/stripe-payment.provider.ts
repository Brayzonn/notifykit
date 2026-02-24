import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PaymentProvider } from './payment-provider.interface';
import { CheckoutSessionRequest } from '@/billing/interfaces/billing.interface';

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(StripePaymentProvider.name);
  private readonly stripe: Stripe | null = null;
  constructor(private readonly configService: ConfigService) {
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      this.logger.warn('STRIPE_SECRET_KEY not configured');
    } else {
      this.stripe = new Stripe(stripeKey);
    }
  }

  async createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<string> {
    if (!this.stripe) {
      throw new InternalServerErrorException('Stripe not configured');
    }

    try {
      const session = await this.stripe.checkout.sessions.create({
        customer_email: request.customerEmail,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: this.getPriceId(request.plan),
            quantity: 1,
          },
        ],
        success_url: `${this.configService.get('FRONTEND_URL')}/user/dashboard/usage?success=true`,
        cancel_url: `${this.configService.get('FRONTEND_URL')}/user/dashboard/usage?cancelled=true`,
        metadata: {
          customerId: request.customerId,
          plan: request.plan,
        },
      });

      if (!session.url) {
        throw new InternalServerErrorException(
          'Stripe session URL not generated',
        );
      }

      this.logger.log(
        `Stripe checkout session created for customer ${request.customerId}`,
      );

      return session.url;
    } catch (error) {
      this.logger.error('Failed to create Stripe checkout session', error);
      throw new InternalServerErrorException(
        'Failed to create checkout session',
      );
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!this.stripe) {
      throw new InternalServerErrorException('Stripe not configured');
    }

    try {
      await this.stripe.subscriptions.cancel(subscriptionId);
      this.logger.log(`Stripe subscription ${subscriptionId} cancelled`);
    } catch (error) {
      this.logger.error('Failed to cancel Stripe subscription', error);
      throw new InternalServerErrorException('Failed to cancel subscription');
    }
  }

  async getPaymentMethods(providerCustomerId: string): Promise<any> {
    if (!this.stripe) {
      throw new InternalServerErrorException('Stripe not configured');
    }

    try {
      const stripeCustomer = await this.stripe.customers.retrieve(
        providerCustomerId,
      );

      if (stripeCustomer.deleted) {
        return { methods: [] };
      }

      const defaultPaymentMethodId =
        stripeCustomer.invoice_settings?.default_payment_method;

      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: providerCustomerId,
        type: 'card',
      });

      return {
        methods: paymentMethods.data.map((pm) => ({
          id: pm.id,
          type: pm.type,
          card: {
            brand: pm.card?.brand,
            last4: pm.card?.last4,
            expMonth: pm.card?.exp_month,
            expYear: pm.card?.exp_year,
          },
          isDefault: pm.id === defaultPaymentMethodId,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to fetch Stripe payment methods', error);
      throw new InternalServerErrorException('Failed to fetch payment methods');
    }
  }

  async getInvoices(providerCustomerId: string): Promise<any[]> {
    if (!this.stripe) {
      throw new InternalServerErrorException('Stripe not configured');
    }

    try {
      const invoices = await this.stripe.invoices.list({
        customer: providerCustomerId,
        limit: 100,
      });

      return invoices.data.map((inv) => ({
        id: inv.id,
        amount: inv.amount_paid / 100, // cents to dollars
        currency: inv.currency,
        status: inv.status,
        date: new Date(inv.created * 1000),
        pdfUrl: inv.invoice_pdf,
      }));
    } catch (error) {
      this.logger.error('Failed to fetch Stripe invoices', error);
      throw new InternalServerErrorException('Failed to fetch invoices');
    }
  }

  private getPriceId(plan: string): string {
    const priceIds = {
      INDIE: this.configService.get('STRIPE_INDIE_PRICE_ID'),
      STARTUP: this.configService.get('STRIPE_STARTUP_PRICE_ID'),
    };

    const priceId = priceIds[plan];
    if (!priceId) {
      throw new BadRequestException(
        `No Stripe price ID configured for plan: ${plan}`,
      );
    }

    return priceId;
  }
}
