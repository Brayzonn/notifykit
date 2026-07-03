import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentProvider as PaymentProviderEnum } from '@prisma/client';
import { PaymentProvider } from './payment-provider.interface';
import { PaystackPaymentProvider } from './paystack-payment.provider';
import { PolarPaymentProvider } from './polar-payment.provider';
import { Currency } from '@/billing/interfaces/billing.interface';

@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly paystackProvider: PaystackPaymentProvider,
    private readonly polarProvider: PolarPaymentProvider,
  ) {}

  getProvider(provider: PaymentProviderEnum): PaymentProvider {
    switch (provider) {
      case PaymentProviderEnum.PAYSTACK:
        return this.paystackProvider;
      case PaymentProviderEnum.POLAR:
        return this.polarProvider;
      case PaymentProviderEnum.STRIPE:
      case PaymentProviderEnum.PADDLE:
      case PaymentProviderEnum.FLUTTERWAVE:
      case PaymentProviderEnum.LEMONSQUEEZY:
        throw new BadRequestException(
          `Payment provider ${provider} not yet implemented`,
        );
      default:
        throw new BadRequestException(
          `Unknown payment provider: ${String(provider)}`,
        );
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
        return this.polarProvider;
      default:
        throw new BadRequestException(
          `Unsupported currency: ${String(currency)}`,
        );
    }
  }
}
