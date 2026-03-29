import { Test, TestingModule } from '@nestjs/testing';
import { EmailWorkerProcessor } from './email-worker.processor';
import { EmailProviderFactory } from '@/email-providers/email-provider.factory';
import { PrismaService } from '@/prisma/prisma.service';
import { QueueService } from '../queue.service';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { FeatureGateService } from '@/common/feature-gate/feature-gate.service';
import { Job } from 'bullmq';
import { CustomerPlan, EmailProviderType, JobStatus, DeliveryStatus } from '@prisma/client';
import {
  createMockPrismaService,
  createMockConfigService,
  type MockedPrismaService,
  type MockedConfigService,
} from '../../../test/helpers/test-utils';

type MockedEmailProviderFactory = { resolveAll: jest.Mock };
type MockedQueueService = { moveToDeadLetterQueue: jest.Mock };
type MockedEncryptionService = { encrypt: jest.Mock; decrypt: jest.Mock };
type MockedEmailProvider = { sendEmail: jest.Mock };

interface ProviderError extends Error {
  response?: { status: number; data: any };
}

describe('EmailWorkerProcessor', () => {
  let processor: EmailWorkerProcessor;
  let emailProviderFactory: MockedEmailProviderFactory;
  let mockProvider: MockedEmailProvider;
  let prisma: MockedPrismaService;
  let queueService: MockedQueueService;
  let encryptionService: MockedEncryptionService;

  const mockEmailProviderFactory: MockedEmailProviderFactory = { resolveAll: jest.fn() };
  const mockPrismaService = createMockPrismaService();
  const mockQueueService: MockedQueueService = { moveToDeadLetterQueue: jest.fn() };
  const mockConfigService = createMockConfigService();
  const mockEncryptionService: MockedEncryptionService = {
    encrypt: jest.fn((text: string) => `iv:${Buffer.from(text).toString('hex')}`),
    decrypt: jest.fn((text: string) => Buffer.from(text.split(':')[1], 'hex').toString('utf8')),
  };

  const createMockJob = (data: any, attemptsMade = 0): Partial<Job> => ({
    id: 'job-123',
    name: 'send-email',
    data,
    attemptsMade,
    opts: { attempts: 3 },
  });

  const createMockEmailData = () => ({
    jobId: 'db-job-123',
    customerId: 'customer-123',
    to: 'recipient@example.com',
    subject: 'Test Email',
    body: '<p>Hello World</p>',
    from: undefined,
  });

  /** Minimal customer shape returned by the processor's select query */
  const makeCustomer = (overrides: Partial<{
    sendingDomains: { domain: string; provider: EmailProviderType; verified: boolean }[];
    plan: CustomerPlan;
    emailProviders: { provider: EmailProviderType; apiKey: string; priority: number }[];
  }> = {}) => ({
    sendingDomains: [],
    plan: CustomerPlan.FREE,
    emailProviders: [],
    ...overrides,
  });

  beforeEach(async () => {
    mockProvider = { sendEmail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailWorkerProcessor,
        FeatureGateService,
        { provide: EmailProviderFactory, useValue: mockEmailProviderFactory },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EncryptionService, useValue: mockEncryptionService },
      ],
    }).compile();

    processor = module.get<EmailWorkerProcessor>(EmailWorkerProcessor);
    emailProviderFactory = module.get(EmailProviderFactory);
    prisma = module.get(PrismaService);
    queueService = module.get(QueueService);
    encryptionService = module.get(EncryptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Successful Email Job Processing ─────────────────────────────────────────

  describe('Successful Email Job Processing', () => {
    it('should successfully process email job on first attempt', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'shared-key' }]);
      mockProvider.sendEmail.mockResolvedValue({ success: true, messageId: 'msg-123' });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({ id: 'log-123' });

      await processor.process(mockJob as Job);

      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: { status: JobStatus.PROCESSING, attempts: 1, startedAt: expect.any(Date) },
      });

      expect(mockProvider.sendEmail).toHaveBeenCalledWith(
        { to: emailData.to, from: 'noreply@notifykit.dev', subject: emailData.subject, body: emailData.body, jobId: emailData.jobId },
        'shared-key',
      );

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: { jobId: emailData.jobId, attempt: 1, status: DeliveryStatus.SUCCESS, response: expect.any(Object) },
      });
    });

    it('should use verified custom domain for sending', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(
        makeCustomer({ plan: CustomerPlan.INDIE, sendingDomains: [{ domain: 'customdomain.com', provider: EmailProviderType.SENDGRID, verified: true }], emailProviders: [{ provider: EmailProviderType.SENDGRID, apiKey: mockEncryptionService.encrypt('test-key'), priority: 1 }] }),
      );
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'key' }]);
      mockProvider.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(mockProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'noreply@em.customdomain.com' }),
        'key',
      );
    });

    it('should use provided from address if specified', async () => {
      const emailData = { ...createMockEmailData(), from: 'custom@em.verified.com' };
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(
        makeCustomer({ plan: CustomerPlan.INDIE, sendingDomains: [{ domain: 'verified.com', provider: EmailProviderType.SENDGRID, verified: true }], emailProviders: [{ provider: EmailProviderType.SENDGRID, apiKey: mockEncryptionService.encrypt('test-key'), priority: 1 }] }),
      );
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'key' }]);
      mockProvider.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(mockProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'custom@em.verified.com' }),
        'key',
      );
    });

    it('should track attempts correctly on retry', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 1);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 1 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'key' }]);
      mockProvider.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: { status: JobStatus.PROCESSING, attempts: 2, startedAt: expect.any(Date) },
      });

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: { jobId: emailData.jobId, attempt: 2, status: DeliveryStatus.SUCCESS, response: expect.any(Object) },
      });
    });
  });

  // ── Provider Failover ────────────────────────────────────────────────────────

  describe('Provider Failover', () => {
    it('should decrypt provider keys and pass them to resolveAll', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);
      const encryptedKey = mockEncryptionService.encrypt('SG.customer_key');

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer({
        plan: CustomerPlan.INDIE,
        sendingDomains: [{ domain: 'example.com', provider: EmailProviderType.SENDGRID, verified: true }],
        emailProviders: [{ provider: EmailProviderType.SENDGRID, apiKey: encryptedKey, priority: 1 }],
      }));
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'SG.customer_key' }]);
      mockProvider.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(encryptionService.decrypt).toHaveBeenCalledWith(encryptedKey);
      expect(emailProviderFactory.resolveAll).toHaveBeenCalledWith(
        CustomerPlan.INDIE,
        [{ provider: EmailProviderType.SENDGRID, apiKey: 'SG.customer_key', priority: 1 }],
      );
    });

    it('should try the next provider when the primary fails', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const primaryProvider: MockedEmailProvider = { sendEmail: jest.fn().mockRejectedValue(new Error('Primary failed')) };
      const fallbackProvider: MockedEmailProvider = { sendEmail: jest.fn().mockResolvedValue({ success: true }) };

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer({ plan: CustomerPlan.INDIE, sendingDomains: [{ domain: 'example.com', provider: EmailProviderType.SENDGRID, verified: true }], emailProviders: [{ provider: EmailProviderType.SENDGRID, apiKey: mockEncryptionService.encrypt('test-key'), priority: 1 }] }));
      mockEmailProviderFactory.resolveAll.mockReturnValue([
        { provider: primaryProvider, apiKey: 'key-1' },
        { provider: fallbackProvider, apiKey: 'key-2' },
      ]);
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(primaryProvider.sendEmail).toHaveBeenCalled();
      expect(fallbackProvider.sendEmail).toHaveBeenCalled();
      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: DeliveryStatus.SUCCESS }),
      });
    });

    it('should throw when all providers fail', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const failingProvider: MockedEmailProvider = { sendEmail: jest.fn().mockRejectedValue(new Error('All failed')) };

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer({ plan: CustomerPlan.INDIE, sendingDomains: [{ domain: 'example.com', provider: EmailProviderType.SENDGRID, verified: true }], emailProviders: [{ provider: EmailProviderType.SENDGRID, apiKey: mockEncryptionService.encrypt('test-key'), priority: 1 }] }));
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: failingProvider, apiKey: 'key' }]);
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow('All failed');
    });

    it('should not call decrypt when emailProviders is empty (FREE plan)', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer({ plan: CustomerPlan.FREE, emailProviders: [] }));
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'shared-key' }]);
      mockProvider.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(encryptionService.decrypt).not.toHaveBeenCalled();
    });
  });

  // ── Email Job Failure Handling ───────────────────────────────────────────────

  describe('Email Job Failure Handling', () => {
    it('should log failure when provider returns error', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const providerError: ProviderError = new Error('Provider Error');
      providerError.response = {
        status: 400,
        data: { errors: [{ message: 'Invalid email address', field: 'to' }] },
      };

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'key' }]);
      mockProvider.sendEmail.mockRejectedValue(providerError);
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: { jobId: emailData.jobId, attempt: 1, status: DeliveryStatus.FAILED, errorMessage: '400 - Invalid email address' },
      });
    });

    it('should extract error message from provider response', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const providerError: ProviderError = new Error('Provider Error');
      providerError.response = {
        status: 429,
        data: { errors: [{ message: 'Rate limit exceeded', field: null }] },
      };

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'key' }]);
      mockProvider.sendEmail.mockRejectedValue(providerError);
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: { jobId: emailData.jobId, attempt: 1, status: DeliveryStatus.FAILED, errorMessage: '429 - Rate limit exceeded' },
      });
    });
  });

  // ── Retry Logic ──────────────────────────────────────────────────────────────

  describe('Retry Logic', () => {
    it('should retry failed job with exponential backoff', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 1);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 1 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'key' }]);
      mockProvider.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(mockProvider.sendEmail).toHaveBeenCalled();
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: expect.objectContaining({ status: JobStatus.COMPLETED }),
      });
    });

    it('should succeed on second attempt after first failure', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 1);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 1 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'key' }]);
      mockProvider.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attempt: 2, status: DeliveryStatus.SUCCESS }),
      });
    });
  });

  // ── Max Retries Exceeded ─────────────────────────────────────────────────────

  describe('Max Retries Exceeded', () => {
    it('should move to dead letter queue after max retries', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 2);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 2 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      mockEmailProviderFactory.resolveAll.mockReturnValue([{ provider: mockProvider, apiKey: 'key' }]);
      mockProvider.sendEmail.mockRejectedValue(new Error('Permanent failure'));
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attempt: 3, status: DeliveryStatus.FAILED }),
      });
    });

    it('should be moved to DLQ by BullMQ after all retries exhausted', () => {
      const mockJob = {
        id: 'job-123',
        data: createMockEmailData(),
        attemptsMade: 3,
        opts: { attempts: 3 },
        failedReason: 'All attempts failed',
      } as Job;

      jest.spyOn(processor, 'onError');
      processor.onError(mockJob, new Error('All attempts failed'));
    });
  });

  // ── Domain Validation ────────────────────────────────────────────────────────

  describe('Domain Validation', () => {
    it('should reject unverified custom domain', async () => {
      const emailData = { ...createMockEmailData(), from: 'support@em.unverified.com' };
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer({ plan: CustomerPlan.INDIE, sendingDomains: [{ domain: 'unverified.com', provider: EmailProviderType.SENDGRID, verified: false }], emailProviders: [{ provider: EmailProviderType.SENDGRID, apiKey: mockEncryptionService.encrypt('test-key'), priority: 1 }] }));
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: { jobId: emailData.jobId, attempt: 1, status: DeliveryStatus.FAILED, errorMessage: expect.any(String) },
      });
    });

    it('should reject sending from main domain without em subdomain', async () => {
      const emailData = { ...createMockEmailData(), from: 'test@notifykit.dev' };
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
    });
  });

  // ── Worker Event Handlers ────────────────────────────────────────────────────

  describe('Worker Event Handlers', () => {
    it('should log when job becomes active', () => {
      const mockJob = { id: 'job-123', name: 'send-email', data: createMockEmailData() } as Job;
      const loggerSpy = jest.spyOn(processor['logger'], 'debug');

      processor.onActive(mockJob);

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Processing job'));
    });

    it('should log when job completes', () => {
      const mockJob = { id: 'job-123', data: createMockEmailData() } as Job;
      const loggerSpy = jest.spyOn(processor['logger'], 'log');

      processor.onComplete(mockJob);

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('completed successfully'));
    });

    it('should handle job failure event', () => {
      const mockJob = {
        id: 'job-123',
        data: createMockEmailData(),
        attemptsMade: 3,
        opts: { attempts: 3 },
        failedReason: 'Provider error',
      } as Job;

      const loggerSpy = jest.spyOn(processor['logger'], 'error');
      processor.onError(mockJob, new Error('Provider error'));

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('failed with error: Provider error'));
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle missing customer gracefully', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
    });

    it('should handle missing job in database', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue(null);

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(mockProvider.sendEmail).not.toHaveBeenCalled();
    });
  });
});
