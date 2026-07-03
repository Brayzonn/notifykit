import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  PaymentProvider,
  ProviderSubscriptionStatus,
} from './payment-provider.interface';
import { CheckoutSessionRequest } from '@/billing/interfaces/billing.interface';
import { getAxiosErrorData } from '@/common/utils/error.util';

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
        getAxiosErrorData(error) ?? error,
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
        throw new InternalServerErrorException(
          `Paystack did not return an email_token for subscription ${subscriptionId}`,
        );
      }

      await firstValueFrom(
        this.httpService.post(
          `${this.paystackUrl}/subscription/disable`,
          {
            code: subscriptionId,
            token: emailToken,
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
        getAxiosErrorData(error) ?? error,
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
        getAxiosErrorData(error) ?? error,
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
        getAxiosErrorData(error) ?? error,
      );
      throw new InternalServerErrorException('Failed to fetch invoices');
    }
  }

  /**
   * Fetch a single subscription by its code. Returns next_payment_date and
   * status. Used on renewal to bump dates without trusting webhook payload.
   */
  async getSubscriptionByCode(subscriptionCode: string): Promise<{
    subscriptionCode: string;
    nextBillingDate: Date | null;
    status: string;
    planCode: string | null;
  } | null> {
    if (!this.secretKey) return null;
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.paystackUrl}/subscription/${subscriptionCode}`,
          { headers: { Authorization: `Bearer ${this.secretKey}` } },
        ),
      );
      const sub = response.data?.data;
      if (!sub) return null;
      return {
        subscriptionCode: sub.subscription_code,
        nextBillingDate: sub.next_payment_date
          ? new Date(sub.next_payment_date)
          : null,
        status: sub.status,
        planCode: sub.plan?.plan_code ?? null,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Paystack subscription ${subscriptionCode}: ${
          getAxiosErrorData<{ message?: string }>(error)?.message ??
          (error as Error).message
        }`,
      );
      return null;
    }
  }

  async getSubscriptionStatus(
    subscriptionId: string,
  ): Promise<ProviderSubscriptionStatus | null> {
    const sub = await this.getSubscriptionByCode(subscriptionId);
    if (!sub) return null;
    return {
      status: sub.status,
      isActive: sub.status === 'active',
      currentPeriodEnd: sub.nextBillingDate,
    };
  }

  /**
   * Find an active subscription for a Paystack customer that matches a given
   * plan. Used by the delayed link processor when subscription.create may have
   * arrived out-of-order or been missed.
   */
  async findActiveSubscriptionByCustomer(
    customerCodeOrNumericId: string | number,
    plan: string,
  ): Promise<{
    subscriptionCode: string;
    nextBillingDate: Date | null;
  } | null> {
    if (!this.secretKey) return null;
    const planCode = this.getPlanCode(plan);

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.paystackUrl}/subscription?customer=${customerCodeOrNumericId}`,
          { headers: { Authorization: `Bearer ${this.secretKey}` } },
        ),
      );
      const subs: any[] = response.data?.data ?? [];
      const active = subs.find(
        (s) => s.status === 'active' && s.plan?.plan_code === planCode,
      );
      if (!active) return null;
      return {
        subscriptionCode: active.subscription_code,
        nextBillingDate: active.next_payment_date
          ? new Date(active.next_payment_date)
          : null,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to list Paystack subscriptions for customer ${customerCodeOrNumericId}: ${
          getAxiosErrorData<{ message?: string }>(error)?.message ??
          (error as Error).message
        }`,
      );
      return null;
    }
  }

  private getPlanAmount(plan: string): number {
    const amounts: Record<string, string | undefined> = {
      INDIE: this.configService.get('PAYSTACK_INDIE_AMOUNT'),
      STARTUP: this.configService.get('PAYSTACK_STARTUP_AMOUNT'),
    };
    const raw = amounts[plan];
    const amount = Number(raw);
    if (!raw || isNaN(amount) || amount <= 0) {
      throw new InternalServerErrorException(
        `PAYSTACK_${plan}_AMOUNT is not configured or invalid (got: ${raw})`,
      );
    }
    return amount;
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
