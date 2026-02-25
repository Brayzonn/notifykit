import { forwardRef, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentModule } from '@/payment/payment.module';
import { RedisModule } from '@/redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule, forwardRef(() => PaymentModule)],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
