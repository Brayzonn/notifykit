import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { QueueService } from './queue.service';
import { SendGridModule } from '@/sendgrid/sendgrid.module';
import { EmailWorkerProcessor } from './processors/email-worker.processor';
import { WebhookWorkerProcessor } from './processors/webhook-worker.processor';

@Module({
  imports: [
    HttpModule,
    SendGridModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
          db: configService.get('REDIS_DB', 0),
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        },
        defaultJobOptions: {
          removeOnComplete: 100, // Keep last 100 completed jobs
          removeOnFail: 500, // Keep last 500 failed jobs
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
        name: 'notifications:email',
      },
      {
        name: 'notifications:webhook',
      },
      {
        name: 'notifications:failed',
      },
    ),
  ],
  providers: [QueueService, EmailWorkerProcessor, WebhookWorkerProcessor],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
