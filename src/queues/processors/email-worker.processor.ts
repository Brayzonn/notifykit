import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryStatus, JobStatus } from '@prisma/client';
import { QUEUE_NAMES } from '@/queues/queue.constants';
import { EmailJobData, QueueService } from '@/queues/queue.service';
import { SendGridService } from '@/sendgrid/sendgrid.service';
import { PrismaService } from '@/prisma/prisma.service';

@Processor(QUEUE_NAMES.EMAIL, { concurrency: 5 })
export class EmailWorkerProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailWorkerProcessor.name);
  private readonly defaultFromEmail: string;

  constructor(
    private readonly sendGridService: SendGridService,
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.defaultFromEmail = this.configService.get<string>(
      'SENDGRID_FROM_EMAIL',
      'noreply@notifykit.dev',
    );
  }

  async process(job: Job<EmailJobData>): Promise<any> {
    const { jobId, customerId, to, subject, body, from } = job.data;

    const currentJob = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { attempts: true },
    });

    const nextAttempt = (currentJob?.attempts || 0) + 1;

    this.logger.log(`Processing email job: ${jobId} (attempt ${nextAttempt})`);

    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { sendingDomain: true, domainVerified: true, plan: true },
      });

      if (!customer) {
        throw new Error(`Customer not found: ${customerId}`);
      }

      const fromAddress = this.determineFromAddress(from, customer);

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.PROCESSING,
          startedAt: new Date(),
          attempts: nextAttempt,
        },
      });

      const response = await this.sendGridService.sendEmail({
        to,
        subject,
        body,
        from: fromAddress,
      });

      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.COMPLETED, completedAt: new Date() },
      });

      await this.prisma.deliveryLog.create({
        data: {
          jobId,
          attempt: nextAttempt,
          status: DeliveryStatus.SUCCESS,
          response,
        },
      });

      this.logger.log(`Email sent successfully from ${fromAddress}: ${jobId}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Email job failed: ${jobId} - ${error.message}`);

      let errorMessage = error.message;
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        // Check for nested error message structures
        if (
          data?.errors &&
          Array.isArray(data.errors) &&
          data.errors.length > 0
        ) {
          errorMessage = `${status} - ${data.errors[0].message || data.errors[0]}`;
        } else if (data?.error?.message) {
          errorMessage = `${status} - ${data.error.message}`;
        } else if (data?.message) {
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
        },
      });

      if (nextAttempt >= 3) {
        await this.queueService.moveToDeadLetterQueue(job.data, errorMessage);
        await this.prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.FAILED, errorMessage },
        });
      }

      throw error;
    }
  }

  private determineFromAddress(
    requestedFrom: string | undefined,
    customer: { sendingDomain: string | null; domainVerified: boolean },
  ): string {
    if (!requestedFrom) {
      return customer.domainVerified && customer.sendingDomain
        ? `noreply@em.${customer.sendingDomain}`
        : this.defaultFromEmail;
    }

    const fromDomain = requestedFrom.split('@')[1];
    const expectedDomain = `em.${customer.sendingDomain}`;

    if (fromDomain === customer.sendingDomain && customer.domainVerified) {
      throw new Error(
        `Cannot send from ${requestedFrom}. Use em.${customer.sendingDomain} instead (e.g., support@em.${customer.sendingDomain})`,
      );
    }

    if (
      (fromDomain === expectedDomain ||
        fromDomain === customer.sendingDomain) &&
      !customer.domainVerified
    ) {
      throw new Error(
        `Cannot send from ${requestedFrom}. Domain ${customer.sendingDomain} is not verified.`,
      );
    }

    //  Restrict NotifyKit domain to only verified addresses
    if (fromDomain === 'notifykit.dev') {
      if (requestedFrom !== this.defaultFromEmail) {
        throw new Error(
          `Cannot send from ${requestedFrom}. Only ${this.defaultFromEmail} is allowed for NotifyKit domain.`,
        );
      }
    }

    return requestedFrom;
  }

  @OnWorkerEvent('active')
  onActive(job: Job<EmailJobData>) {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);
  }

  @OnWorkerEvent('completed')
  onComplete(job: Job<EmailJobData>) {
    this.logger.log(`Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job<EmailJobData>, error: Error) {
    this.logger.error(`Job ${job.id} failed with error: ${error.message}`);
  }
}
