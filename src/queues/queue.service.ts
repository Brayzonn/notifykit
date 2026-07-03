import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailProviderType } from '@prisma/client';
import {
  QUEUE_NAMES,
  QueueType,
  JOB_NAMES,
  QUEUE_PRIORITIES,
} from './queue.constants';
import { getErrorMessage } from '@/common/utils/error.util';
import { PlatformEmailJobData } from './processors/platform-email.processor';
import { PrismaService } from '@/prisma/prisma.service';

export interface EmailJobData {
  jobId: string;
  customerId: string;
  to: string;
  subject: string;
  body: string;
  from?: string;
  provider?: EmailProviderType;
  fallback?: EmailProviderType;
}

export interface WebhookJobData {
  jobId: string;
  customerId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  payload: any;
}

export interface PaystackSubscriptionLinkJobData {
  customerId: string;
  customerCode: string;
  customerNumericId?: number;
  plan: 'INDIE' | 'STARTUP';
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.EMAIL)
    private emailQueue: Queue<EmailJobData>,
    @InjectQueue(QUEUE_NAMES.WEBHOOK)
    private webhookQueue: Queue<WebhookJobData>,
    @InjectQueue(QUEUE_NAMES.FAILED)
    private failedQueue: Queue<any>,
    @InjectQueue(QUEUE_NAMES.PAYMENT_TASKS)
    private paymentQueue: Queue<PaystackSubscriptionLinkJobData>,
    @InjectQueue(QUEUE_NAMES.PLATFORM_EMAIL)
    private platformEmailQueue: Queue<PlatformEmailJobData>,
    private readonly prisma: PrismaService,
  ) {}

  async enqueuePlatformEmail(
    data: Omit<PlatformEmailJobData, 'logId'>,
  ): Promise<void> {
    const log = await this.prisma.platformEmailLog.create({
      data: {
        label: data.label,
        to: data.to,
        subject: data.subject,
      },
    });

    try {
      await this.platformEmailQueue.add(
        JOB_NAMES.SEND_PLATFORM_EMAIL,
        { ...data, logId: log.id },
        {
          priority: QUEUE_PRIORITIES.CRITICAL,
          attempts: 3,
          backoff: { type: 'exponential', delay: 15000 },
        },
      );
    } catch (error) {
      await this.prisma.platformEmailLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', errorMessage: getErrorMessage(error) },
      });
      this.logger.error(
        `Failed to enqueue platform email [${data.label}] to ${data.to}: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Schedule a delayed back-fill of the Paystack subscription code/dates after
   * a successful initial charge. Idempotent per customerId — duplicate webhooks
   * collapse to one queued job.
   */
  async schedulePaystackSubscriptionLink(
    data: PaystackSubscriptionLinkJobData,
    delayMs: number = 10_000,
  ) {
    try {
      const job = await this.paymentQueue.add(
        JOB_NAMES.LINK_PAYSTACK_SUBSCRIPTION,
        data,
        {
          jobId: `link:${data.customerId}`,
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
      this.logger.log(
        `Scheduled Paystack subscription link for customer ${data.customerId} in ${delayMs}ms`,
      );
      return job;
    } catch (error) {
      this.logger.error(
        `Failed to schedule subscription link: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Add email notification to queue
   */
  async addEmailJob(
    data: EmailJobData,
    priority: number = QUEUE_PRIORITIES.NORMAL,
    isRetry: boolean = false,
  ) {
    try {
      const job = await this.emailQueue.add(JOB_NAMES.SEND_EMAIL, data, {
        jobId: isRetry ? undefined : data.jobId,
        priority,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 120000,
        },
      });

      this.logger.log(
        `Email job queued: ${job.id} for customer: ${data.customerId}`,
      );
      return job;
    } catch (error) {
      this.logger.error(`Failed to queue email job: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Add webhook notification to queue
   */
  async addWebhookJob(
    data: WebhookJobData,
    priority: number = QUEUE_PRIORITIES.NORMAL,
    isRetry: boolean = false,
  ) {
    try {
      const job = await this.webhookQueue.add(JOB_NAMES.SEND_WEBHOOK, data, {
        jobId: isRetry ? undefined : data.jobId,
        priority,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 120000,
        },
      });

      this.logger.log(
        `Webhook job queued: ${job.id} for customer: ${data.customerId}`,
      );
      return job;
    } catch (error) {
      this.logger.error(
        `Failed to queue webhook job: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Move failed job to dead letter queue
   */
  async moveToDeadLetterQueue(
    jobData: EmailJobData | WebhookJobData,
    error: string,
  ) {
    try {
      await this.failedQueue.add(
        JOB_NAMES.FAILED_JOB,
        {
          ...jobData,
          failedAt: new Date(),
          error,
        },
        {
          priority: QUEUE_PRIORITIES.LOW,
        },
      );

      this.logger.warn(`Job moved to DLQ: ${jobData.jobId} - Error: ${error}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to move job to DLQ: ${message}`);
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: QueueType) {
    const queue =
      queueName === 'email'
        ? this.emailQueue
        : queueName === 'webhook'
          ? this.webhookQueue
          : this.failedQueue;

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Get all queue statistics
   */
  async getAllQueueStats() {
    const [emailStats, webhookStats, failedStats] = await Promise.all([
      this.getQueueStats('email'),
      this.getQueueStats('webhook'),
      this.getQueueStats('failed'),
    ]);

    return {
      email: emailStats,
      webhook: webhookStats,
      failed: failedStats,
    };
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: 'email' | 'webhook') {
    const queue = queueName === 'email' ? this.emailQueue : this.webhookQueue;
    await queue.pause();
    this.logger.warn(`Queue paused: ${queueName}`);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: 'email' | 'webhook') {
    const queue = queueName === 'email' ? this.emailQueue : this.webhookQueue;
    await queue.resume();
    this.logger.log(`Queue resumed: ${queueName}`);
  }

  /**
   * Clear all jobs from a queue
   */
  async clearQueue(queueName: 'email' | 'webhook' | 'failed') {
    const queue =
      queueName === 'email'
        ? this.emailQueue
        : queueName === 'webhook'
          ? this.webhookQueue
          : this.failedQueue;

    await queue.drain();
    this.logger.warn(`Queue cleared: ${queueName}`);
  }
}
