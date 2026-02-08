import { Module, forwardRef } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { StripeWebhookHandler } from './webhooks/stripe-webhook.handler';
import { BillingModule } from '@/billing/billing.module';
import { EmailModule } from '@/email/email.module';

@Module({
  imports: [PrismaModule, EmailModule, forwardRef(() => BillingModule)],
  controllers: [PaymentController],
  providers: [PaymentService, StripeWebhookHandler],
  exports: [PaymentService],
})
export class PaymentModule {}
