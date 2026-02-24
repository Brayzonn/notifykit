import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { QueueModule } from '../queues/queue.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '@/billing/billing.module';

@Module({
  imports: [QueueModule, AuthModule, BillingModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
