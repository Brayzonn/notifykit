import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentProvider as PaymentProviderEnum } from '@prisma/client';
import { PaymentProvider } from './payment-provider.interface';
import { PaystackPaymentProvider } from './paystack-payment.provider';
import { Currency } from '@/billing/interfaces/billing.interface';

@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly paystackProvider: PaystackPaymentProvider,
  ) {}

  getProvider(provider: PaymentProviderEnum): PaymentProvider {
    switch (provider) {
      case PaymentProviderEnum.PAYSTACK:
        return this.paystackProvider;
      case PaymentProviderEnum.POLAR:
      case PaymentProviderEnum.STRIPE:
      case PaymentProviderEnum.PADDLE:
      case PaymentProviderEnum.FLUTTERWAVE:
      case PaymentProviderEnum.LEMONSQUEEZY:
        throw new BadRequestException(
          `Payment provider ${provider} not yet implemented`,
        );
      default:
        throw new BadRequestException(`Unknown payment provider: ${provider}`);
    }
  }

  /**
   * Route a checkout request to the provider that handles the requested currency.
   * USD → Polar, NGN → Paystack.
   */
  getProviderByCurrency(currency: Currency): PaymentProvider {
    switch (currency) {
      case 'NGN':
        return this.paystackProvider;
      case 'USD':
        throw new BadRequestException(
          'USD payments are not yet available. Please use NGN.',
        );
      default:
        throw new BadRequestException(`Unsupported currency: ${currency}`);
    }
  }
}
