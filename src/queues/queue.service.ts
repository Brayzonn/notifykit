import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  QueueType,
  JOB_NAMES,
  QUEUE_PRIORITIES,
} from './queue.constants';

export interface EmailJobData {
  jobId: string;
  customerId: string;
  to: string;
  subject: string;
  body: string;
  from?: string;
}

export interface WebhookJobData {
  jobId: string;
  customerId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  payload: any;
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
  ) {}

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
      this.logger.error(`Failed to queue email job: ${error.message}`);
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
      this.logger.error(`Failed to queue webhook job: ${error.message}`);
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
      this.logger.error(`Failed to move job to DLQ: ${err.message}`);
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
