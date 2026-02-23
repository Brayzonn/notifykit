import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CheckoutSessionRequest } from '@/billing/interfaces/billing.interface';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { PaymentProvider } from '@prisma/client';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  async createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<string> {
    const provider = this.providerFactory.getDefaultProvider();
    return provider.createCheckoutSession(request);
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { providerSubscriptionId: subscriptionId },
    });

    if (!customer || !customer.paymentProvider) {
      throw new NotFoundException(
        'Customer not found or payment provider not set',
      );
    }

    const provider = this.providerFactory.getProvider(customer.paymentProvider);
    return provider.cancelSubscription(subscriptionId);
  }

  async getPaymentMethods(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });

    if (
      !customer ||
      !customer.providerCustomerId ||
      !customer.paymentProvider
    ) {
      return { methods: [] };
    }

    const provider = this.providerFactory.getProvider(customer.paymentProvider);
    return provider.getPaymentMethods(customer.providerCustomerId);
  }

  async getInvoices(
    providerCustomerId: string,
    paymentProvider: string,
  ): Promise<any[]> {
    const provider = this.providerFactory.getProvider(
      paymentProvider as PaymentProvider,
    );
    return provider.getInvoices(providerCustomerId);
  }
}
