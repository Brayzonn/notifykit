import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { StripeWebhookHandler } from './webhooks/stripe-webhook.handler';
import { PaystackWebhookHandler } from './webhooks/paystack-webhook.handler';
import { BillingModule } from '@/billing/billing.module';
import { EmailModule } from '@/email/email.module';
import { StripePaymentProvider } from './providers/stripe-payment.provider';
import { PaystackPaymentProvider } from './providers/paystack-payment.provider';
import { PaymentProviderFactory } from './providers/payment-provider.factory';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    HttpModule,
    forwardRef(() => BillingModule),
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    StripeWebhookHandler,
    PaystackWebhookHandler,
    StripePaymentProvider,
    PaystackPaymentProvider,
    PaymentProviderFactory,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
