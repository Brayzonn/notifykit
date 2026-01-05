import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryStatus, JobStatus } from '@prisma/client';
import { QUEUE_NAMES } from '../queue.constants';
import { EmailJobData, QueueService } from '../queue.service';
import { SendGridService } from '../../sendgrid/sendgrid.service';
import { PrismaService } from '../../prisma/prisma.service';

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
      'noreply@notifyhub.com',
    );
  }

  async process(job: Job<EmailJobData>): Promise<any> {
    const { jobId, customerId, to, subject, body, from } = job.data;

    this.logger.log(
      `Processing email job: ${jobId} (attempt ${job.attemptsMade + 1})`,
    );

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
          attempts: job.attemptsMade + 1,
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
          attempt: job.attemptsMade + 1,
          status: DeliveryStatus.SUCCESS,
          response,
        },
      });

      this.logger.log(`Email sent successfully from ${fromAddress}: ${jobId}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Email job failed: ${jobId} - ${error.message}`);

      await this.prisma.deliveryLog.create({
        data: {
          jobId,
          attempt: job.attemptsMade + 1,
          status: DeliveryStatus.FAILED,
          errorMessage: error.message,
        },
      });

      if (job.attemptsMade >= 2) {
        await this.queueService.moveToDeadLetterQueue(job.data, error.message);
        await this.prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.FAILED, errorMessage: error.message },
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

    if (
      (fromDomain === expectedDomain ||
        fromDomain === customer.sendingDomain) &&
      !customer.domainVerified
    ) {
      throw new Error(
        `Cannot send from ${requestedFrom}. Domain ${customer.sendingDomain} is not verified.`,
      );
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
