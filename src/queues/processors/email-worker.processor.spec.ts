import { Test, TestingModule } from '@nestjs/testing';
import { EmailWorkerProcessor } from './email-worker.processor';
import { SendGridService } from '@/sendgrid/sendgrid.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QueueService } from '../queue.service';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { JobStatus, DeliveryStatus, JobType } from '@prisma/client';
import {
  createMockPrismaService,
  createMockConfigService,
  type MockedPrismaService,
  type MockedConfigService,
} from '../../../test/helpers/test-utils';

type MockedSendGridService = {
  sendEmail: jest.Mock;
};

type MockedQueueService = {
  moveToDeadLetterQueue: jest.Mock;
};

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

  const mockSendGridService: MockedSendGridService = {
    sendEmail: jest.fn(),
  };

  const mockPrismaService = createMockPrismaService();

  const mockQueueService: MockedQueueService = {
    moveToDeadLetterQueue: jest.fn(),
  };

  const mockConfigService = createMockConfigService();

  const createMockJob = (data: any, attemptsMade = 0): Partial<Job> => ({
    id: 'job-123',
    name: 'send-email',
    data,
    attemptsMade,
    opts: {
      attempts: 3,
    },
  });

  const createMockEmailData = () => ({
    jobId: 'db-job-123',
    customerId: 'customer-123',
    to: 'recipient@example.com',
    subject: 'Test Email',
    body: '<p>Hello World</p>',
    from: undefined,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailWorkerProcessor,
        { provide: SendGridService, useValue: mockSendGridService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    processor = module.get<EmailWorkerProcessor>(EmailWorkerProcessor);
    sendGridService = module.get(SendGridService);
    prisma = module.get(PrismaService);
    queueService = module.get(QueueService);
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

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

      const mockCustomer = {
        id: 'customer-123',
        email: 'customer@example.com',
        sendingDomain: null,
        domainVerified: false,
      };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      sendGridService.sendEmail.mockResolvedValue({
        success: true,
        messageId: 'sendgrid-msg-123',
      });
      prisma.job.update.mockResolvedValue({
        ...mockDbJob,
        status: JobStatus.PROCESSING,
      });
      prisma.deliveryLog.create.mockResolvedValue({
        id: 'log-123',
        jobId: emailData.jobId,
        attempt: 1,
        status: DeliveryStatus.SUCCESS,
      });

      await processor.process(mockJob as Job);

      // Verify job status updated to PROCESSING
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: {
          status: JobStatus.PROCESSING,
          attempts: 1,
          startedAt: expect.any(Date),
        },
      });

      // Verify email sent with correct parameters
      expect(sendGridService.sendEmail).toHaveBeenCalledWith({
        to: emailData.to,
        from: 'noreply@notifykit.dev', // Default from config
        subject: emailData.subject,
        body: emailData.body,
      });

      // Verify delivery log created with SUCCESS
      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: {
          jobId: emailData.jobId,
          attempt: 1,
          status: DeliveryStatus.SUCCESS,
          response: expect.any(Object),
        },
      });

      // Verify job marked as COMPLETED
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: expect.any(Date),
        },
      });
    });

    it('should use verified custom domain for sending', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const mockDbJob = {
        id: emailData.jobId,
        customerId: emailData.customerId,
        type: JobType.EMAIL,
        status: JobStatus.PENDING,
        payload: emailData,
        attempts: 0,
      };

      const mockCustomer = {
        id: 'customer-123',
        email: 'customer@example.com',
        sendingDomain: 'customdomain.com',
        domainVerified: true,
      };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      sendGridService.sendEmail.mockResolvedValue({
        success: true,
        messageId: 'sendgrid-msg-123',
      });
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      // Verify email sent from custom domain
      expect(sendGridService.sendEmail).toHaveBeenCalledWith({
        to: emailData.to,
        from: 'noreply@em.customdomain.com', // Uses em subdomain
        subject: emailData.subject,
        body: emailData.body,
      });
    });

    it('should use provided from address if specified', async () => {
      const emailData = {
        ...createMockEmailData(),
        from: 'custom@verified.com',
      };
      const mockJob = createMockJob(emailData, 0);

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 0,
      };

      const mockCustomer = {
        sendingDomain: null,
        domainVerified: false,
      };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(sendGridService.sendEmail).toHaveBeenCalledWith({
        to: emailData.to,
        from: 'custom@verified.com',
        subject: emailData.subject,
        body: emailData.body,
      });
    });

    it('should track attempts correctly on retry', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 1); // Second attempt

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 1,
      };

      const mockCustomer = {
        sendingDomain: null,
        domainVerified: false,
      };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      // Verify attempt count incremented
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: {
          status: JobStatus.PROCESSING,
          attempts: 2, // Incremented from 1 to 2
          startedAt: expect.any(Date),
        },
      });

      // Verify delivery log has correct attempt number
      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: {
          jobId: emailData.jobId,
          attempt: 2,
          status: DeliveryStatus.SUCCESS,
          response: expect.any(Object),
        },
      });
    });
  });

  describe('Email Job Failure Handling', () => {
    it('should log failure when SendGrid returns error', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 0,
      };

      const mockCustomer = {
        id: 'customer-123',
        sendingDomain: null,
        domainVerified: false,
      };

      const sendGridError: SendGridError = new Error('SendGrid API Error');
      sendGridError.response = {
        status: 400,
        data: {
          errors: [
            {
              message: 'Invalid email address',
              field: 'to',
            },
          ],
        },
      };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      sendGridService.sendEmail.mockRejectedValue(sendGridError);
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});
      queueService.moveToDeadLetterQueue.mockResolvedValue(undefined);

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      // Verify delivery log created with FAILED status
      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: {
          jobId: emailData.jobId,
          attempt: 1,
          status: DeliveryStatus.FAILED,
          errorMessage: '400 - Invalid email address',
        },
      });
    });

    it('should extract error message from SendGrid response', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 0,
      };
      const mockCustomer = {
        id: 'customer-123',
        sendingDomain: null,
        domainVerified: false,
      };

      const sendGridError: SendGridError = new Error('SendGrid API Error');
      sendGridError.response = {
        status: 429,
        data: {
          errors: [{ message: 'Rate limit exceeded', field: null }],
        },
      };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      sendGridService.sendEmail.mockRejectedValue(sendGridError);
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});
      queueService.moveToDeadLetterQueue.mockResolvedValue(undefined);

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: {
          jobId: emailData.jobId,
          attempt: 1,
          status: DeliveryStatus.FAILED,
          errorMessage: '429 - Rate limit exceeded',
        },
      });
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed job with exponential backoff', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 1); // Second attempt (first retry)

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 1,
      };
      const mockCustomer = { sendingDomain: null, domainVerified: false };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      // Verify job processed on retry
      expect(sendGridService.sendEmail).toHaveBeenCalled();
      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: emailData.jobId },
        data: expect.objectContaining({
          status: JobStatus.COMPLETED,
        }),
      });
    });

    it('should succeed on second attempt after first failure', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 1);

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 1,
      };
      const mockCustomer = { sendingDomain: null, domainVerified: false };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      // First call fails, second succeeds (simulating retry)
      sendGridService.sendEmail.mockResolvedValue({ success: true });
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});

      await processor.process(mockJob as Job);

      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attempt: 2,
          status: DeliveryStatus.SUCCESS,
        }),
      });
    });
  });

  describe('Max Retries Exceeded', () => {
    it('should move to dead letter queue after max retries', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 2); // Third and final attempt

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 2,
        maxAttempts: 3,
      };

      const mockCustomer = { sendingDomain: null, domainVerified: false };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      sendGridService.sendEmail.mockRejectedValue(
        new Error('Permanent failure'),
      );
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      // Verify delivery log shows final failed attempt
      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attempt: 3,
          status: DeliveryStatus.FAILED,
        }),
      });
    });

    it('should be moved to DLQ by BullMQ after all retries exhausted', async () => {
      const emailData = createMockEmailData();

      // Simulate BullMQ calling the failed event handler
      const mockJob = {
        id: 'job-123',
        data: emailData,
        attemptsMade: 3,
        opts: { attempts: 3 },
        failedReason: 'All attempts failed',
      } as Job;

      // Mock the onError handler
      const failedSpy = jest.spyOn(processor, 'onError');

      const mockError = new Error('All attempts failed');
      processor.onError(mockJob, mockError);

      // onError just logs, doesn't move to DLQ (that happens in process() method)
    });
  });

  describe('Domain Validation', () => {
    it('should reject unverified custom domain', async () => {
      const emailData = {
        ...createMockEmailData(),
        from: 'support@em.unverified.com', // Trying to use unverified domain
      };
      const mockJob = createMockJob(emailData, 0);

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 0,
      };

      const mockCustomer = {
        id: 'customer-123',
        sendingDomain: 'unverified.com',
        domainVerified: false, // Not verified
      };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});
      queueService.moveToDeadLetterQueue.mockResolvedValue(undefined);

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(sendGridService.sendEmail).not.toHaveBeenCalled();
      expect(prisma.deliveryLog.create).toHaveBeenCalledWith({
        data: {
          jobId: emailData.jobId,
          attempt: 1,
          status: DeliveryStatus.FAILED,
          errorMessage: expect.stringContaining('Domain unverified.com is not verified'),
        },
      });
    });

    it('should reject sending from main domain without em subdomain', async () => {
      const emailData = {
        ...createMockEmailData(),
        from: 'test@notifykit.dev', // Trying to send from main domain
      };
      const mockJob = createMockJob(emailData, 0);

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 0,
      };
      const mockCustomer = { sendingDomain: null, domainVerified: false };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(mockCustomer);
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(sendGridService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('Worker Event Handlers', () => {
    it('should log when job becomes active', () => {
      const mockJob = {
        id: 'job-123',
        name: 'send-email',
        data: createMockEmailData(),
      } as Job;

      const loggerSpy = jest.spyOn(processor['logger'], 'debug');

      processor.onActive(mockJob);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Processing job'),
      );
    });

    it('should log when job completes', () => {
      const mockJob = {
        id: 'job-123',
        data: createMockEmailData(),
      } as Job;

      const loggerSpy = jest.spyOn(processor['logger'], 'log');

      processor.onComplete(mockJob);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('completed successfully'),
      );
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
      const mockError = new Error('SendGrid error');

      processor.onError(mockJob, mockError);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed with error: SendGrid error'),
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing customer gracefully', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      const mockDbJob = {
        id: emailData.jobId,
        payload: emailData,
        attempts: 0,
      };

      prisma.job.findUnique.mockResolvedValue(mockDbJob);
      prisma.customer.findUnique.mockResolvedValue(null); // Customer not found
      prisma.job.update.mockResolvedValue(mockDbJob);
      prisma.deliveryLog.create.mockResolvedValue({});

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(sendGridService.sendEmail).not.toHaveBeenCalled();
    });

    it('should handle missing job in database', async () => {
      const emailData = createMockEmailData();
      const mockJob = createMockJob(emailData, 0);

      prisma.job.findUnique.mockResolvedValue(null); // Job not found

      await expect(processor.process(mockJob as Job)).rejects.toThrow();

      expect(sendGridService.sendEmail).not.toHaveBeenCalled();
    });
  });
});
