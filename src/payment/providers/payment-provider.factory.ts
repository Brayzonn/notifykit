import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentProvider as PaymentProviderEnum } from '@prisma/client';
import { PaymentProvider } from './payment-provider.interface';
import { StripePaymentProvider } from './stripe-payment.provider';
import { PaystackPaymentProvider } from './paystack-payment.provider';

@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly stripeProvider: StripePaymentProvider,
    private readonly paystackProvider: PaystackPaymentProvider,
  ) {}

  getProvider(provider: PaymentProviderEnum): PaymentProvider {
    switch (provider) {
      case PaymentProviderEnum.STRIPE:
        return this.stripeProvider;
      case PaymentProviderEnum.PAYSTACK:
        return this.paystackProvider;
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
   * Get the default provider (currently Paystack)
   * This is used when creating new checkout sessions
   */
  getDefaultProvider(): PaymentProvider {
    return this.paystackProvider;
  }

  /**
   * Get the default provider name
   */
  getDefaultProviderName(): PaymentProviderEnum {
    return PaymentProviderEnum.PAYSTACK;
  }
}
