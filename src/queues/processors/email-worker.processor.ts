import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerPlan, DeliveryStatus, JobStatus, Prisma } from '@prisma/client';
import { QUEUE_NAMES } from '@/queues/queue.constants';
import { EmailJobData, QueueService } from '@/queues/queue.service';
import { EmailProviderFactory, ProviderConfig } from '@/email-providers/email-provider.factory';
import { PrismaService } from '@/prisma/prisma.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { FeatureGateService } from '@/common/feature-gate/feature-gate.service';

@Processor(QUEUE_NAMES.EMAIL, { concurrency: 5 })
export class EmailWorkerProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailWorkerProcessor.name);
  private readonly defaultFromEmail: string;

  constructor(
    private readonly emailProviderFactory: EmailProviderFactory,
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
    private readonly featureGate: FeatureGateService,
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
        select: {
          sendingDomain: true,
          domainVerified: true,
          plan: true,
          emailProviders: {
            orderBy: { priority: 'asc' },
            select: { provider: true, apiKey: true, priority: true },
          },
        },
      });

      if (!customer) {
        throw new UnrecoverableError(`Customer not found: ${customerId}`);
      }

      if (
        customer.plan !== CustomerPlan.FREE &&
        customer.emailProviders.length === 0
      ) {
        throw new UnrecoverableError(
          'No email provider configured. Please add an API key in Settings.',
        );
      }

      this.featureGate.assertCanSendEmailFromDomain(customer);

      if (customer.sendingDomain) {
        this.featureGate.assertCanUseCustomDomain(customer);
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

      const decryptedProviders: ProviderConfig[] = customer.emailProviders.map(
        (p) => ({
          provider: p.provider,
          apiKey: this.encryptionService.decrypt(p.apiKey),
          priority: p.priority,
        }),
      );

      const resolvedProviders = this.emailProviderFactory.resolveAll(
        customer.plan,
        decryptedProviders,
      );

      let response: any;
      let lastError: Error | undefined;

      for (const { provider, apiKey } of resolvedProviders) {
        try {
          response = await provider.sendEmail(
            { to, subject, body, from: fromAddress, jobId },
            apiKey,
          );
          lastError = undefined;
          break;
        } catch (err) {
          this.logger.warn(
            `Provider failed for job ${jobId}, trying next: ${err.message}`,
          );
          lastError = err;
        }
      }

      if (lastError) throw lastError;

      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.COMPLETED, completedAt: new Date(), payload: Prisma.DbNull },
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
      if (error instanceof UnrecoverableError) {
        this.logger.error(`Email job permanently failed: ${jobId} - ${error.message}`);
        await this.prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.FAILED, errorMessage: error.message, attempts: nextAttempt },
        });
        await this.prisma.deliveryLog.create({
          data: { jobId, attempt: nextAttempt, status: DeliveryStatus.FAILED, errorMessage: error.message },
        });
        throw error;
      }

      if (error instanceof ForbiddenException) {
        throw new UnrecoverableError(error.message);
      }

      this.logger.error(`Email job failed: ${jobId} - ${error.message}`);

      let errorMessage = error.message;
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

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

      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          attempts: nextAttempt,
          status: nextAttempt >= 3 ? JobStatus.FAILED : JobStatus.PENDING,
          errorMessage: nextAttempt >= 3 ? errorMessage : undefined,
        },
      });

      if (nextAttempt >= 3) {
        await this.queueService.moveToDeadLetterQueue(job.data, errorMessage);
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

    const [localPart, fromDomain] = requestedFrom.split('@');

    if (fromDomain === 'notifykit.dev') {
      if (requestedFrom !== this.defaultFromEmail) {
        throw new UnrecoverableError(
          `Cannot send from ${requestedFrom}. Only ${this.defaultFromEmail} is allowed.`,
        );
      }
      return requestedFrom;
    }

    if (!customer.sendingDomain) {
      throw new UnrecoverableError(
        `Custom from address is not allowed. Upgrade your plan to use a custom domain.`,
      );
    }

    if (
      (fromDomain === customer.sendingDomain ||
        fromDomain === `em.${customer.sendingDomain}`) &&
      !customer.domainVerified
    ) {
      throw new UnrecoverableError(
        `Cannot send from ${requestedFrom}. Domain ${customer.sendingDomain} is not verified.`,
      );
    }

    if (fromDomain === customer.sendingDomain && customer.domainVerified) {
      return `${localPart}@em.${customer.sendingDomain}`;
    }

    if (
      fromDomain === `em.${customer.sendingDomain}` &&
      customer.domainVerified
    ) {
      return requestedFrom;
    }

    throw new UnrecoverableError(
      `Cannot send from ${requestedFrom}. Use your verified domain ${customer.sendingDomain} instead.`,
    );
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
