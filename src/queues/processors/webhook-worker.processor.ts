import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobStatus, DeliveryStatus, Prisma } from '@prisma/client';
import { QUEUE_NAMES } from '../queue.constants';
import { WebhookJobData, QueueService } from '../queue.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  getErrorMessage,
  getAxiosErrorData,
  getAxiosErrorStatus,
} from '@/common/utils/error.util';

@Processor(QUEUE_NAMES.WEBHOOK, {
  concurrency: 5,
})
export class WebhookWorkerProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookWorkerProcessor.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<any> {
    const { jobId, url, method, headers, payload } = job.data;

    const currentJob = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { attempts: true },
    });

    const nextAttempt = (currentJob?.attempts || 0) + 1;

    this.logger.log(
      `Processing webhook job: ${jobId} (attempt ${job.attemptsMade + 1})`,
    );

    try {
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.PROCESSING,
          startedAt: new Date(),
          attempts: nextAttempt,
        },
      });

      const response = await firstValueFrom(
        this.httpService.request({
          url,
          method: method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NotifyKit/1.0',
            ...headers,
          },
          data: payload,
          timeout: 30000,
          validateStatus: (status) => status >= 200 && status < 300,
        }),
      );

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: new Date(),
          payload: Prisma.DbNull,
        },
      });

      await this.prisma.deliveryLog.create({
        data: {
          jobId,
          attempt: nextAttempt,
          status: DeliveryStatus.SUCCESS,
          response: {
            statusCode: response.status,
            body: response.data,
          },
        },
      });

      this.logger.log(
        `Webhook delivered successfully: ${jobId} - Status: ${response.status}`,
      );
      return { success: true };
    } catch (error) {
      this.logger.error(`Webhook job failed: ${jobId} - ${getErrorMessage(error)}`);

      const status = getAxiosErrorStatus(error);
      const data = getAxiosErrorData<{
        error?: { message?: string };
        message?: string;
      } | string>(error);

      const errorResponse =
        status !== undefined ? { statusCode: status, body: data } : null;

      let errorMessage = getErrorMessage(error);
      if (status !== undefined) {
        if (typeof data === 'object' && data?.error?.message) {
          errorMessage = `${status} - ${data.error.message}`;
        } else if (typeof data === 'object' && data?.message) {
          errorMessage = `${status} - ${data.message}`;
        } else if (typeof data === 'string') {
          errorMessage = `${status} - ${data}`;
        } else {
          errorMessage = `Request failed with status ${status}`;
        }
      }

      await this.prisma.deliveryLog.create({
        data: {
          jobId,
          attempt: nextAttempt,
          status: DeliveryStatus.FAILED,
          errorMessage,
          response: errorResponse ?? undefined,
        },
      });

      const shouldRetry = this.shouldRetryWebhook(error);

      if (!shouldRetry || nextAttempt >= 3) {
        await this.queueService.moveToDeadLetterQueue(job.data, errorMessage);

        await this.prisma.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.FAILED,
            errorMessage,
          },
        });

        if (!shouldRetry) {
          this.logger.warn(
            `Not retrying webhook job ${jobId} - Client error (4xx)`,
          );
          return;
        }
      }

      throw error;
    }
  }

  private shouldRetryWebhook(error: any): boolean {
    if (
      error.response &&
      error.response.status >= 400 &&
      error.response.status < 500
    ) {
      return false;
    }

    return true;
  }

  @OnWorkerEvent('active')
  onActive(job: Job<WebhookJobData>) {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);
  }

  @OnWorkerEvent('completed')
  onComplete(job: Job<WebhookJobData>) {
    this.logger.log(`Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job<WebhookJobData>, error: Error) {
    this.logger.error(`Job ${job.id} failed with error: ${error.message}`);
  }
}
