import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaystackWebhookHandler } from './webhooks/paystack-webhook.handler';
import { BillingModule } from '@/billing/billing.module';
import { EmailModule } from '@/email/email.module';
import { PaystackPaymentProvider } from './providers/paystack-payment.provider';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { RateLimitModule } from '@/common/rate-limit/rate-limit.module';
import { PaystackSignatureGuard } from './guards/paystack-signature.guard';
import { QueueModule } from '@/queues/queue.module';
import { PaystackSubscriptionLinkProcessor } from './processors/paystack-subscription-link.processor';
import { PaymentWebhookEventService } from './payment-webhook-event.service';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    HttpModule,
    forwardRef(() => BillingModule),
    RateLimitModule,
    QueueModule,
    BullModule.registerQueue({ name: 'payment-tasks' }),
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PaystackWebhookHandler,
    PaystackPaymentProvider,
    PaymentProviderFactory,
    PaystackSignatureGuard,
    PaystackSubscriptionLinkProcessor,
    PaymentWebhookEventService,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
