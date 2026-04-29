import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerPlan, DeliveryStatus, EmailProviderType, JobStatus, Prisma } from '@prisma/client';
import { QUEUE_NAMES } from '@/queues/queue.constants';
import { EmailJobData, QueueService } from '@/queues/queue.service';
import {
  EmailProviderFactory,
  ProviderConfig,
  ResolvedProvider,
} from '@/email-providers/email-provider.factory';
import { PrismaService } from '@/prisma/prisma.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { FeatureGateService } from '@/common/feature-gate/feature-gate.service';
import {
  getErrorMessage,
  getAxiosErrorData,
  getAxiosErrorStatus,
} from '@/common/utils/error.util';

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
    const {
      jobId,
      customerId,
      to,
      subject,
      body,
      from,
      provider: forcedProvider,
      fallback,
    } = job.data;

    const currentJob = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { attempts: true },
    });

    const nextAttempt = (currentJob?.attempts || 0) + 1;

    this.logger.log(`Processing email job: ${jobId} (attempt ${nextAttempt})`);

    let lastAttemptedProvider: EmailProviderType | undefined;

    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          plan: true,
          sendingDomains: {
            select: { domain: true, provider: true, verified: true },
          },
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

      this.featureGate.assertCanSendEmailFromDomain({
        plan: customer.plan,
        hasDomain: customer.sendingDomains.length > 0,
        hasVerifiedDomain: customer.sendingDomains.some((d) => d.verified),
      });

      if (customer.sendingDomains.length > 0) {
        this.featureGate.assertCanUseCustomDomain(customer);
      }

      const fromAddress = this.determineFromAddress(from, customer.sendingDomains);

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

      let attemptList: ResolvedProvider[];
      if (forcedProvider) {
        const primary = this.emailProviderFactory.resolveOne(
          customer.plan,
          decryptedProviders,
          forcedProvider,
        );
        if (!primary) {
          throw new UnrecoverableError(
            `Provider ${forcedProvider} is not configured for this customer.`,
          );
        }
        attemptList = [primary];
        if (fallback) {
          const fb = this.emailProviderFactory.resolveOne(
            customer.plan,
            decryptedProviders,
            fallback,
          );
          if (!fb) {
            throw new UnrecoverableError(
              `Fallback provider ${fallback} is not configured for this customer.`,
            );
          }
          attemptList.push(fb);
        }
      } else {
        attemptList = this.emailProviderFactory.resolveAll(
          customer.plan,
          decryptedProviders,
        );
      }

      let response: any;
      let lastError: Error | undefined;
      let successfulProvider: EmailProviderType | undefined;

      for (const entry of attemptList) {
        lastAttemptedProvider = entry.type;
        try {
          response = await entry.provider.sendEmail(
            { to, subject, body, from: fromAddress, jobId },
            entry.apiKey,
          );
          lastError = undefined;
          successfulProvider = entry.type;
          break;
        } catch (err) {
          this.logger.warn(
            `Provider ${entry.type} failed for job ${jobId}: ${getErrorMessage(err)}`,
          );
          lastError = err as Error;
        }
      }

      if (lastError) {
        // Forced routing is a contract — don't let BullMQ retry through
        // providers the customer didn't authorize.
        if (forcedProvider) {
          throw new UnrecoverableError(
            `Configured provider(s) failed: ${getErrorMessage(lastError)}`,
          );
        }
        throw lastError;
      }

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
          usedProvider: successfulProvider,
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
          data: {
            jobId,
            attempt: nextAttempt,
            status: DeliveryStatus.FAILED,
            errorMessage: error.message,
            usedProvider: lastAttemptedProvider,
          },
        });
        throw error;
      }

      if (error instanceof ForbiddenException) {
        this.logger.error(`Email job permanently failed: ${jobId} - ${error.message}`);
        await this.prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.FAILED, errorMessage: error.message, attempts: nextAttempt },
        });
        await this.prisma.deliveryLog.create({
          data: {
            jobId,
            attempt: nextAttempt,
            status: DeliveryStatus.FAILED,
            errorMessage: error.message,
            usedProvider: lastAttemptedProvider,
          },
        });
        throw new UnrecoverableError(error.message);
      }

      this.logger.error(`Email job failed: ${jobId} - ${getErrorMessage(error)}`);

      let errorMessage = getErrorMessage(error);
      const status = getAxiosErrorStatus(error);
      const data = getAxiosErrorData<{
        errors?: Array<{ message?: string } | string>;
        error?: { message?: string };
        message?: string;
      } | string>(error);

      if (status !== undefined) {
        if (
          typeof data === 'object' &&
          data?.errors &&
          Array.isArray(data.errors) &&
          data.errors.length > 0
        ) {
          const first = data.errors[0];
          const firstMessage =
            typeof first === 'string' ? first : first?.message;
          errorMessage = `${status} - ${firstMessage ?? 'unknown'}`;
        } else if (typeof data === 'object' && data?.error?.message) {
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
          usedProvider: lastAttemptedProvider,
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
    sendingDomains: Array<{ domain: string; provider: string; verified: boolean }>,
  ): string {
    const verifiedDomains = sendingDomains.filter((d) => d.verified);

    if (!requestedFrom) {
      const verifiedDomain = verifiedDomains[0]?.domain ?? null;
      return verifiedDomain
        ? `noreply@em.${verifiedDomain}`
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

    if (verifiedDomains.length === 0) {
      throw new UnrecoverableError(
        `Custom from address is not allowed. Upgrade your plan to use a custom domain.`,
      );
    }

    const matchedDomain = verifiedDomains.find(
      (d) => fromDomain === d.domain || fromDomain === `em.${d.domain}`,
    );

    const pendingDomain = sendingDomains.find(
      (d) => !d.verified && (fromDomain === d.domain || fromDomain === `em.${d.domain}`),
    );

    if (pendingDomain && !matchedDomain) {
      throw new UnrecoverableError(
        `Cannot send from ${requestedFrom}. Domain ${pendingDomain.domain} is not yet verified.`,
      );
    }

    if (!matchedDomain) {
      const verifiedList = verifiedDomains.map((d) => d.domain).join(', ');
      throw new UnrecoverableError(
        `Cannot send from ${requestedFrom}. Use one of your verified domains: ${verifiedList}.`,
      );
    }

    if (fromDomain === matchedDomain.domain) {
      return `${localPart}@em.${matchedDomain.domain}`;
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
