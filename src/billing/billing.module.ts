import { forwardRef, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingCronService } from './billing.cron.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentModule } from '@/payment/payment.module';
import { RedisModule } from '@/redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule, forwardRef(() => PaymentModule)],
  controllers: [BillingController],
  providers: [BillingService, BillingCronService],
  exports: [BillingService],
})
export class BillingModule {}
