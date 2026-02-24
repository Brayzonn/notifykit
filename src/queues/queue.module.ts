import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { QueueService } from './queue.service';
import { SendGridModule } from '@/sendgrid/sendgrid.module';
import { EmailWorkerProcessor } from './processors/email-worker.processor';
import { WebhookWorkerProcessor } from './processors/webhook-worker.processor';
import { EncryptionModule } from '@/common/encryption/encryption.module';

@Module({
  imports: [
    HttpModule,
    SendGridModule,
    EncryptionModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
          db: configService.get('REDIS_DB', 0),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 500,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      {
        name: 'notifications-email',
      },
      {
        name: 'notifications-webhook',
      },
      {
        name: 'notifications-failed',
      },
    ),
  ],
  providers: [QueueService, EmailWorkerProcessor, WebhookWorkerProcessor],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
