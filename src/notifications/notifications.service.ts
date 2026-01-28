import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queues/queue.service';
import { QUEUE_PRIORITIES } from '../queues/queue.constants';
import { SendEmailDto } from './dto/send-email.dto';
import { SendWebhookDto } from './dto/send-webhook.dto';
import { JobType, JobStatus } from '@prisma/client';
import { toApiStatus } from '@/common/utils/enum.util';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Create and queue an email notification job
   */
  async sendEmail(customerId: string, dto: SendEmailDto) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.job.findFirst({
        where: {
          customerId,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      if (existing) {
        this.logger.warn(`Duplicate email job detected: ${dto.idempotencyKey}`);
        throw new ConflictException({
          message: 'Duplicate request detected',
          existingJobId: existing.id,
        });
      }
    }

    const job = await this.prisma.job.create({
      data: {
        customerId,
        type: JobType.EMAIL,
        status: JobStatus.PENDING,
        priority: dto.priority || QUEUE_PRIORITIES.NORMAL,
        payload: {
          to: dto.to,
          subject: dto.subject,
          body: dto.body,
          from: dto.from,
        },
        idempotencyKey: dto.idempotencyKey,
        attempts: 0,
        maxAttempts: 3,
      },
    });

    await this.queueService.addEmailJob(
      {
        jobId: job.id,
        customerId,
        to: dto.to,
        subject: dto.subject,
        body: dto.body,
        from: dto.from,
      },
      dto.priority || QUEUE_PRIORITIES.NORMAL,
    );

    this.logger.log(`Email job created and queued: ${job.id}`);

    return {
      jobId: job.id,
      status: toApiStatus(job.status),
      type: job.type.toLowerCase(),
      createdAt: job.createdAt,
    };
  }

  /**
   * Create and queue a webhook notification job
   */
  async sendWebhook(customerId: string, dto: SendWebhookDto) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.job.findFirst({
        where: {
          customerId,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      if (existing) {
        this.logger.warn(
          `Duplicate webhook job detected: ${dto.idempotencyKey}`,
        );
        throw new ConflictException({
          message: 'Duplicate request detected',
          existingJobId: existing.id,
        });
      }
    }

    const job = await this.prisma.job.create({
      data: {
        customerId,
        type: JobType.WEBHOOK,
        status: JobStatus.PENDING,
        priority: dto.priority || QUEUE_PRIORITIES.NORMAL,
        payload: {
          url: dto.url,
          method: dto.method || 'POST',
          headers: dto.headers,
          payload: dto.payload,
        },
        idempotencyKey: dto.idempotencyKey,
        attempts: 0,
        maxAttempts: 3,
      },
    });

    await this.queueService.addWebhookJob(
      {
        jobId: job.id,
        customerId,
        url: dto.url,
        method: dto.method || 'POST',
        headers: dto.headers,
        payload: dto.payload,
      },
      dto.priority || QUEUE_PRIORITIES.NORMAL,
    );

    this.logger.log(`Webhook job created and queued: ${job.id}`);

    return {
      jobId: job.id,
      status: toApiStatus(job.status),
      type: job.type.toLowerCase(),
      createdAt: job.createdAt,
    };
  }

  /**
   * Get job status by ID
   */
  async getJobStatus(customerId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        customerId,
      },
      select: {
        id: true,
        type: true,
        status: true,
        priority: true,
        payload: true,
        attempts: true,
        maxAttempts: true,
        errorMessage: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });

    if (!job) {
      return null;
    }

    return {
      ...job,
      status: toApiStatus(job.status),
      type: job.type.toLowerCase(),
    };
  }

  /**
   * List jobs for a customer with pagination and filters
   */
  async listJobs(
    customerId: string,
    options: {
      page?: number;
      limit?: number;
      type?: 'email' | 'webhook';
      status?: 'pending' | 'processing' | 'completed' | 'failed';
    } = {},
  ) {
    const page = options.page || 1;
    const limit = Math.min(options.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where = {
      customerId,
      ...(options.type && { type: JobType[options.type.toUpperCase()] }),
      ...(options.status && {
        status: JobStatus[options.status.toUpperCase()],
      }),
    };

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        select: {
          id: true,
          type: true,
          status: true,
          priority: true,
          attempts: true,
          errorMessage: true,
          createdAt: true,
          completedAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.job.count({ where }),
    ]);

    const formattedJobs = jobs.map((job) => ({
      ...job,
      status: toApiStatus(job.status),
      type: job.type.toLowerCase(),
    }));

    return {
      data: formattedJobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retry a failed job
   */
  async retryJob(customerId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        customerId,
        status: JobStatus.FAILED,
      },
    });

    if (!job) {
      return null;
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.PENDING,
        attempts: 0,
        errorMessage: null,
      },
    });

    if (job.type === JobType.EMAIL) {
      const payload = job.payload as any;
      await this.queueService.addEmailJob(
        {
          jobId: job.id,
          customerId,
          to: payload.to,
          subject: payload.subject,
          body: payload.body,
          from: payload.from,
        },
        job.priority,
      );
    } else if (job.type === JobType.WEBHOOK) {
      const payload = job.payload as any;
      await this.queueService.addWebhookJob(
        {
          jobId: job.id,
          customerId,
          url: payload.url,
          method: payload.method,
          headers: payload.headers,
          payload: payload.payload,
        },
        job.priority,
      );
    }

    this.logger.log(`Job retried: ${jobId}`);

    return {
      jobId: job.id,
      status: 'pending',
      message: 'Job has been re-queued for processing',
    };
  }
}
