import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PaymentProvider } from './payment-provider.interface';
import { CheckoutSessionRequest } from '@/billing/interfaces/billing.interface';

@Injectable()
export class PaystackPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(PaystackPaymentProvider.name);
  private readonly paystackUrl = 'https://api.paystack.co';
  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.secretKey =
      this.configService.get<string>('PAYSTACK_SECRET_KEY') || '';
    this.webhookSecret =
      this.configService.get<string>('PAYSTACK_WEBHOOK_SECRET') || '';

    if (!this.secretKey) {
      this.logger.warn('PAYSTACK_SECRET_KEY not configured');
    }
  }

  async createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<string> {
    if (!this.secretKey) {
      throw new InternalServerErrorException('Paystack not configured');
    }

    try {
      const planCode = this.getPlanCode(request.plan);

      const response = await firstValueFrom(
        this.httpService.post(
          `${this.paystackUrl}/transaction/initialize`,
          {
            email: request.customerEmail,
            plan: planCode,
            amount: this.getPlanAmount(request.plan),
            callback_url: `${this.configService.get('FRONTEND_URL')}/user/dashboard/usage?success=true`,
            metadata: {
              customerId: request.customerId,
              plan: request.plan,
              cancel_action: `${this.configService.get('FRONTEND_URL')}/user/dashboard/usage?cancelled=true`,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      if (!response.data?.data?.authorization_url) {
        throw new InternalServerErrorException(
          'Paystack authorization URL not generated',
        );
      }

      this.logger.log(
        `Paystack transaction initialized for customer ${request.customerId}`,
      );

      return response.data.data.authorization_url;
    } catch (error) {
      this.logger.error(
        'Failed to create Paystack transaction',
        error?.response?.data || error,
      );
      throw new InternalServerErrorException(
        'Failed to create checkout session',
      );
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!this.secretKey) {
      throw new InternalServerErrorException('Paystack not configured');
    }

    try {
      const subscriptionResponse = await firstValueFrom(
        this.httpService.get(
          `${this.paystackUrl}/subscription/${subscriptionId}`,
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
            },
          },
        ),
      );

      const emailToken = subscriptionResponse.data?.data?.email_token;

      if (!emailToken) {
        this.logger.warn(
          `No email token found for subscription ${subscriptionId}, attempting disable with subscription code`,
        );
      }

      await firstValueFrom(
        this.httpService.post(
          `${this.paystackUrl}/subscription/disable`,
          {
            code: subscriptionId,
            token: emailToken || subscriptionId,
          },
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `Paystack subscription ${subscriptionId} disabled/cancelled`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to cancel Paystack subscription',
        error?.response?.data || error,
      );
      throw new InternalServerErrorException('Failed to cancel subscription');
    }
  }

  async getPaymentMethods(providerCustomerId: string): Promise<any> {
    if (!this.secretKey) {
      throw new InternalServerErrorException('Paystack not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.paystackUrl}/customer/${providerCustomerId}`,
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
            },
          },
        ),
      );

      const authorizations = response.data?.data?.authorizations || [];

      return {
        methods: authorizations
          .filter((auth: any) => auth.channel === 'card' && auth.reusable)
          .map((auth: any) => ({
            id: auth.authorization_code,
            type: 'card',
            card: {
              brand: auth.card_type,
              last4: auth.last4,
              expMonth: auth.exp_month,
              expYear: auth.exp_year,
              bank: auth.bank,
            },
            isDefault: false,
          })),
      };
    } catch (error) {
      this.logger.error(
        'Failed to fetch Paystack payment methods',
        error?.response?.data || error,
      );

      return { methods: [] };
    }
  }

  async getInvoices(providerCustomerId: string): Promise<any[]> {
    if (!this.secretKey) {
      throw new InternalServerErrorException('Paystack not configured');
    }

    try {
      const customerResponse = await firstValueFrom(
        this.httpService.get(
          `${this.paystackUrl}/customer/${providerCustomerId}`,
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
            },
          },
        ),
      );

      const customerId = customerResponse.data?.data?.id;

      if (!customerId) {
        this.logger.warn(
          `Could not find numeric ID for customer ${providerCustomerId}`,
        );
        return [];
      }

      const response = await firstValueFrom(
        this.httpService.get(
          `${this.paystackUrl}/transaction?customer=${customerId}&status=success&perPage=100`,
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
            },
          },
        ),
      );

      const transactions = response.data?.data || [];

      return transactions.map((tx: any) => ({
        id: tx.reference,
        amount: tx.amount,
        currency: tx.currency,
        status: tx.status,
        date: new Date(tx.paid_at || tx.created_at),
        pdfUrl: null,
      }));
    } catch (error) {
      this.logger.error(
        'Failed to fetch Paystack transactions',
        error?.response?.data || error,
      );
      throw new InternalServerErrorException('Failed to fetch invoices');
    }
  }

  private getPlanAmount(plan: string): number {
    const amounts: Record<string, string | undefined> = {
      INDIE: this.configService.get('PAYSTACK_INDIE_AMOUNT'),
      STARTUP: this.configService.get('PAYSTACK_STARTUP_AMOUNT'),
    };
    return Number(amounts[plan]);
  }

  getPlanCode(plan: string): string {
    const planCodes: Record<string, string | undefined> = {
      INDIE: this.configService.get('PAYSTACK_INDIE_PLAN_ID'),
      STARTUP: this.configService.get('PAYSTACK_STARTUP_PLAN_ID'),
    };

    const planCode = planCodes[plan];
    if (!planCode) {
      throw new BadRequestException(
        `No Paystack plan code configured for plan: ${plan}`,
      );
    }

    return planCode;
  }
}
