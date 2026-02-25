import { Test, TestingModule } from '@nestjs/testing';
import { EmailWorkerProcessor } from './email-worker.processor';
import { SendGridService } from '@/sendgrid/sendgrid.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QueueService } from '../queue.service';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { Job } from 'bullmq';
import { CustomerPlan, JobStatus, DeliveryStatus, JobType } from '@prisma/client';
import {
  createMockPrismaService,
  createMockConfigService,
  type MockedPrismaService,
  type MockedConfigService,
} from '../../../test/helpers/test-utils';

type MockedSendGridService = { sendEmail: jest.Mock };
type MockedQueueService = { moveToDeadLetterQueue: jest.Mock };
type MockedEncryptionService = { encrypt: jest.Mock; decrypt: jest.Mock };

interface SendGridErrorResponse {
  status: number;
  data: {
    errors?: Array<{ message: string; field: string | null }>;
    error?: { message: string };
    message?: string;
  };
}

interface SendGridError extends Error {
  response?: SendGridErrorResponse;
}

describe('EmailWorkerProcessor', () => {
  let processor: EmailWorkerProcessor;
  let sendGridService: MockedSendGridService;
  let prisma: MockedPrismaService;
  let queueService: MockedQueueService;
  let configService: MockedConfigService;
  let encryptionService: MockedEncryptionService;

  const mockSendGridService: MockedSendGridService = { sendEmail: jest.fn() };
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
    sendingDomain: string | null;
    domainVerified: boolean;
    plan: CustomerPlan;
    sendgridApiKey: string | null;
  }> = {}) => ({
    sendingDomain: null,
    domainVerified: false,
    plan: CustomerPlan.FREE,
    sendgridApiKey: null,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailWorkerProcessor,
        { provide: SendGridService, useValue: mockSendGridService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EncryptionService, useValue: mockEncryptionService },
      ],
    }).compile();

    processor = module.get<EmailWorkerProcessor>(EmailWorkerProcessor);
    sendGridService = module.get(SendGridService);
    prisma = module.get(PrismaService);
    queueService = module.get(QueueService);
    configService = module.get(ConfigService);
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

      const mockDbJob = {
        id: emailData.jobId,
        customerId: emailData.customerId,
        type: JobType.EMAIL,
        status: JobStatus.PENDING,
        payload: emailData,
        attempts: 0,
        maxAttempts: 3,
      };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      sendGridService.sendEmail.mockResolvedValue({ success: true, messageId: 'sendgrid-msg-123' });
      prisma.job.update.mockResolvedValue({ ...mockDbJob, status: JobStatus.PROCESSING });
      prisma.deliveryLog.create.mockResolvedValue({ id: 'log-123' });

      await processor.process(mockJob as Job);

      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: { status: JobStatus.PROCESSING, attempts: 1, startedAt: expect.any(Date) },
      });

      expect(sendGridService.sendEmail).toHaveBeenCalledWith(
        { to: emailData.to, from: 'noreply@notifykit.dev', subject: emailData.subject, body: emailData.body },
        undefined,
        CustomerPlan.FREE,
      );

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: { jobId: emailData.jobId, attempt: 1, status: DeliveryStatus.SUCCESS, response: expect.any(Object) },
      });

      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: { status: JobStatus.COMPLETED, completedAt: expect.any(Date) },
      });
    });

    it('should use verified custom domain for sending', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer({ sendingDomain: 'customdomain.com', domainVerified: true }));
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(sendGridService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'noreply@em.customdomain.com' }),
        undefined,
        CustomerPlan.FREE,
      );
    });

    it('should use provided from address if specified', async () => {
      const emailData = { ...createMockEmailData(), from: 'custom@verified.com' };
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(sendGridService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'custom@verified.com' }),
        undefined,
        CustomerPlan.FREE,
      );
    });

    it('should track attempts correctly on retry', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 1);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 1 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      sendGridService.sendEmail.mockResolvedValue({ success: true });
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

  // ── Per-Customer SendGrid Key ────────────────────────────────────────────────

  describe('Per-Customer SendGrid API Key', () => {
    it('should decrypt and pass the customer key for INDIE plan', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);
      const encryptedKey = mockEncryptionService.encrypt('SG.customer_key_indie');

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(
        makeCustomer({ plan: CustomerPlan.INDIE, sendgridApiKey: encryptedKey }),
      );
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(encryptionService.decrypt).toHaveBeenCalledWith(encryptedKey);
      expect(sendGridService.sendEmail).toHaveBeenCalledWith(
        expect.any(Object),
        'SG.customer_key_indie',
        CustomerPlan.INDIE,
      );
    });

    it('should decrypt and pass the customer key for STARTUP plan', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);
      const encryptedKey = mockEncryptionService.encrypt('SG.customer_key_startup');

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(
        makeCustomer({ plan: CustomerPlan.STARTUP, sendgridApiKey: encryptedKey }),
      );
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(encryptionService.decrypt).toHaveBeenCalledWith(encryptedKey);
      expect(sendGridService.sendEmail).toHaveBeenCalledWith(
        expect.any(Object),
        'SG.customer_key_startup',
        CustomerPlan.STARTUP,
      );
    });

    it('should pass undefined key for FREE plan with no sendgridApiKey', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer({ plan: CustomerPlan.FREE, sendgridApiKey: null }));
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(encryptionService.decrypt).not.toHaveBeenCalled();
      expect(sendGridService.sendEmail).toHaveBeenCalledWith(
        expect.any(Object),
        undefined,
        CustomerPlan.FREE,
      );
    });

    it('should not call decrypt when sendgridApiKey is null', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(
        makeCustomer({ plan: CustomerPlan.INDIE, sendgridApiKey: null }),
      );
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(encryptionService.decrypt).not.toHaveBeenCalled();
      expect(sendGridService.sendEmail).toHaveBeenCalledWith(
        expect.any(Object),
        undefined,
        CustomerPlan.INDIE,
      );
    });
  });

  // ── Email Job Failure Handling ───────────────────────────────────────────────

  describe('Email Job Failure Handling', () => {
    it('should log failure when SendGrid returns error', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const sendGridError: SendGridError = new Error('SendGrid API Error');
      sendGridError.response = {
        status: 400,
        data: { errors: [{ message: 'Invalid email address', field: 'to' }] },
      };

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      sendGridService.sendEmail.mockRejectedValue(sendGridError);
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: { jobId: emailData.jobId, attempt: 1, status: DeliveryStatus.FAILED, errorMessage: '400 - Invalid email address' },
      });
    });

    it('should extract error message from SendGrid response', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const sendGridError: SendGridError = new Error('SendGrid API Error');
      sendGridError.response = {
        status: 429,
        data: { errors: [{ message: 'Rate limit exceeded', field: null }] },
      };

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      sendGridService.sendEmail.mockRejectedValue(sendGridError);
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

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 1 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(sendGridService.sendEmail).toHaveBeenCalled();
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: expect.objectContaining({ status: JobStatus.COMPLETED }),
      });
    });

    it('should succeed on second attempt after first failure', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 1);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 1 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      sendGridService.sendEmail.mockResolvedValue({ success: true });
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

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 2, maxAttempts: 3 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      sendGridService.sendEmail.mockRejectedValue(new Error('Permanent failure'));
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attempt: 3, status: DeliveryStatus.FAILED }),
      });
    });

    it('should be moved to DLQ by BullMQ after all retries exhausted', async () => {
      const emailData = createMockEmailData();
      const mockJob = {
        id: 'job-123',
        data: emailData,
        attemptsMade: 3,
        opts: { attempts: 3 },
        failedReason: 'All attempts failed',
      } as Job;

      const failedSpy = jest.spyOn(processor, 'onError');
      const mockError = new Error('All attempts failed');
      processor.onError(mockJob, mockError);
    });
  });

  // ── Domain Validation ────────────────────────────────────────────────────────

  describe('Domain Validation', () => {
    it('should reject unverified custom domain', async () => {
      const emailData = { ...createMockEmailData(), from: 'support@em.unverified.com' };
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer({ sendingDomain: 'unverified.com', domainVerified: false }));
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(sendGridService.sendEmail).not.toHaveBeenCalled();
      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: { jobId: emailData.jobId, attempt: 1, status: DeliveryStatus.FAILED, errorMessage: expect.stringContaining('Domain unverified.com is not verified') },
      });
    });

    it('should reject sending from main domain without em subdomain', async () => {
      const emailData = { ...createMockEmailData(), from: 'test@notifykit.dev' };
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(makeCustomer());
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(sendGridService.sendEmail).not.toHaveBeenCalled();
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
        failedReason: 'SendGrid error',
      } as Job;

      const loggerSpy = jest.spyOn(processor['logger'], 'error');
      processor.onError(mockJob, new Error('SendGrid error'));

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('failed with error: SendGrid error'));
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle missing customer gracefully', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue({ id: emailData.jobId, payload: emailData, attempts: 0 });
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.job.update.mockResolvedValue({});
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(sendGridService.sendEmail).not.toHaveBeenCalled();
    });

    it('should handle missing job in database', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue(null);

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(sendGridService.sendEmail).not.toHaveBeenCalled();
    });
  });
});
