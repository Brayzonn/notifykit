import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QueueService } from '@/queues/queue.service';
import { createMockCustomer } from '../../test/helpers/mock-factories';
import {
  createMockPrismaService,
  type MockedPrismaService,
} from '../../test/helpers/test-utils';
import { CustomerPlan, JobStatus, JobType } from '@prisma/client';
import { QUEUE_PRIORITIES } from '@/queues/queue.constants';

type MockedQueueService = {
  addEmailJob: jest.Mock;
  addWebhookJob: jest.Mock;
};

// ── Shared fixtures ───────────────────────────────────────────────────────────

const makeJob = (overrides: Partial<Record<string, any>> = {}) => ({
  id: 'job-123',
  type: JobType.EMAIL,
  status: JobStatus.PENDING,
  priority: QUEUE_PRIORITIES.NORMAL,
  payload: { to: 'user@example.com', subject: 'Hello', body: '<p>Hi</p>' },
  attempts: 0,
  maxAttempts: 3,
  errorMessage: null,
  idempotencyKey: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  startedAt: null,
  completedAt: null,
  ...overrides,
});

const emailDto = {
  to: 'user@example.com',
  subject: 'Hello',
  body: '<p>Hi</p>',
  from: 'sender@example.com',
};

const webhookDto = {
  url: 'https://example.com/webhook',
  method: 'POST' as const,
  headers: { 'X-Custom': 'header' },
  payload: { event: 'user.created' },
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: MockedPrismaService;
  let queueService: MockedQueueService;

  const mockQueueService: MockedQueueService = {
    addEmailJob: jest.fn(),
    addWebhookJob: jest.fn(),
  };

  const mockPrismaService = createMockPrismaService();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get(PrismaService);
    queueService = module.get(QueueService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ── sendEmail ────────────────────────────────────────────────────────────────

  describe('sendEmail', () => {
    beforeEach(() => {
      // Default happy-path setup
      prisma.job.findFirst.mockResolvedValue(null); // no duplicate
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.FREE }),
      );
      prisma.job.create.mockResolvedValue(makeJob());
      queueService.addEmailJob.mockResolvedValue(undefined);
    });

    it('should throw ConflictException when an idempotency duplicate exists', async () => {
      const existingJob = makeJob({ id: 'job-existing' });
      prisma.job.findFirst.mockResolvedValue(existingJob);

      await expect(
        service.sendEmail('customer-123', {
          ...emailDto,
          idempotencyKey: 'idem-key-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should include the existingJobId in the ConflictException response', async () => {
      prisma.job.findFirst.mockResolvedValue(makeJob({ id: 'job-existing' }));

      const error = await service
        .sendEmail('customer-123', { ...emailDto, idempotencyKey: 'idem-key-1' })
        .catch((e) => e);

      expect(error.getResponse()).toMatchObject({ existingJobId: 'job-existing' });
    });

    it('should not check idempotency when no key is provided', async () => {
      await service.sendEmail('customer-123', emailDto);

      expect(prisma.job.findFirst).not.toHaveBeenCalled();
    });

    it('should throw when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.sendEmail('customer-123', emailDto)).rejects.toThrow(
        'Customer not found: customer-123',
      );
    });

    it('should throw BadRequestException for INDIE plan without a SendGrid API key', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.INDIE, sendgridApiKey: null }),
      );

      await expect(service.sendEmail('customer-123', emailDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for STARTUP plan without a SendGrid API key', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.STARTUP, sendgridApiKey: null }),
      );

      await expect(service.sendEmail('customer-123', emailDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should allow FREE plan to proceed without a SendGrid API key', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.FREE, sendgridApiKey: null }),
      );

      await expect(service.sendEmail('customer-123', emailDto)).resolves.toBeDefined();
    });

    it('should create the job in Prisma with the correct fields', async () => {
      await service.sendEmail('customer-123', emailDto);

      expect(prisma.job.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 'customer-123',
          type: JobType.EMAIL,
          status: JobStatus.PENDING,
          priority: QUEUE_PRIORITIES.NORMAL,
          payload: {
            to: emailDto.to,
            subject: emailDto.subject,
            body: emailDto.body,
            from: emailDto.from,
          },
          attempts: 0,
          maxAttempts: 3,
        }),
      });
    });

    it('should queue the email job via QueueService', async () => {
      const job = makeJob({ id: 'job-abc' });
      prisma.job.create.mockResolvedValue(job);

      await service.sendEmail('customer-123', emailDto);

      expect(queueService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-abc',
          customerId: 'customer-123',
          to: emailDto.to,
          subject: emailDto.subject,
          body: emailDto.body,
          from: emailDto.from,
        }),
        QUEUE_PRIORITIES.NORMAL,
      );
    });

    it('should use the custom priority when provided', async () => {
      await service.sendEmail('customer-123', {
        ...emailDto,
        priority: QUEUE_PRIORITIES.CRITICAL,
      });

      expect(prisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: QUEUE_PRIORITIES.CRITICAL }),
        }),
      );
      expect(queueService.addEmailJob).toHaveBeenCalledWith(
        expect.any(Object),
        QUEUE_PRIORITIES.CRITICAL,
      );
    });

    it('should return jobId, status, type, and createdAt', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      prisma.job.create.mockResolvedValue(
        makeJob({ id: 'job-xyz', status: JobStatus.PENDING, type: JobType.EMAIL, createdAt }),
      );

      const result = await service.sendEmail('customer-123', emailDto);

      expect(result).toEqual({
        jobId: 'job-xyz',
        status: 'pending',
        type: 'email',
        createdAt,
      });
    });
  });

  // ── sendWebhook ──────────────────────────────────────────────────────────────

  describe('sendWebhook', () => {
    const mockWebhookJob = makeJob({
      id: 'job-webhook-1',
      type: JobType.WEBHOOK,
      payload: { url: webhookDto.url, method: 'POST', headers: webhookDto.headers, payload: webhookDto.payload },
    });

    beforeEach(() => {
      prisma.job.findFirst.mockResolvedValue(null);
      prisma.job.create.mockResolvedValue(mockWebhookJob);
      queueService.addWebhookJob.mockResolvedValue(undefined);
    });

    it('should throw ConflictException when an idempotency duplicate exists', async () => {
      prisma.job.findFirst.mockResolvedValue(makeJob({ id: 'job-existing' }));

      await expect(
        service.sendWebhook('customer-123', { ...webhookDto, idempotencyKey: 'idem-key-2' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create the webhook job in Prisma with the correct fields', async () => {
      await service.sendWebhook('customer-123', webhookDto);

      expect(prisma.job.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 'customer-123',
          type: JobType.WEBHOOK,
          status: JobStatus.PENDING,
          priority: QUEUE_PRIORITIES.NORMAL,
          payload: {
            url: webhookDto.url,
            method: 'POST',
            headers: webhookDto.headers,
            payload: webhookDto.payload,
          },
          attempts: 0,
          maxAttempts: 3,
        }),
      });
    });

    it('should default method to POST when not provided', async () => {
      const { method, ...dtoWithoutMethod } = webhookDto;

      await service.sendWebhook('customer-123', dtoWithoutMethod);

      expect(prisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payload: expect.objectContaining({ method: 'POST' }),
          }),
        }),
      );
    });

    it('should queue the webhook job via QueueService', async () => {
      await service.sendWebhook('customer-123', webhookDto);

      expect(queueService.addWebhookJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: mockWebhookJob.id,
          customerId: 'customer-123',
          url: webhookDto.url,
          method: 'POST',
        }),
        QUEUE_PRIORITIES.NORMAL,
      );
    });

    it('should return jobId, status, type, and createdAt', async () => {
      const result = await service.sendWebhook('customer-123', webhookDto);

      expect(result).toEqual({
        jobId: mockWebhookJob.id,
        status: 'pending',
        type: 'webhook',
        createdAt: mockWebhookJob.createdAt,
      });
    });
  });

  // ── getJobStatus ─────────────────────────────────────────────────────────────

  describe('getJobStatus', () => {
    it('should return null when the job is not found', async () => {
      prisma.job.findFirst.mockResolvedValue(null);

      const result = await service.getJobStatus('customer-123', 'job-missing');

      expect(result).toBeNull();
    });

    it('should return the job with lowercased status and type', async () => {
      const job = makeJob({
        id: 'job-123',
        type: JobType.EMAIL,
        status: JobStatus.COMPLETED,
      });
      prisma.job.findFirst.mockResolvedValue(job);

      const result = await service.getJobStatus('customer-123', 'job-123');

      expect(result).toMatchObject({
        id: 'job-123',
        status: 'completed',
        type: 'email',
      });
    });
  });

  // ── listJobs ─────────────────────────────────────────────────────────────────

  describe('listJobs', () => {
    const mockJobList = [makeJob({ id: 'job-1' }), makeJob({ id: 'job-2' })];

    beforeEach(() => {
      prisma.job.findMany.mockResolvedValue(mockJobList);
      prisma.job.count.mockResolvedValue(2);
    });

    it('should default to page 1 and limit 20', async () => {
      await service.listJobs('customer-123');

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('should cap limit at 100', async () => {
      await service.listJobs('customer-123', { limit: 500 });

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('should apply a type filter when provided', async () => {
      await service.listJobs('customer-123', { type: 'email' });

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: JobType.EMAIL }),
        }),
      );
    });

    it('should apply a status filter when provided', async () => {
      await service.listJobs('customer-123', { status: 'failed' });

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: JobStatus.FAILED }),
        }),
      );
    });

    it('should return data with correct pagination meta', async () => {
      prisma.job.count.mockResolvedValue(45);

      const result = await service.listJobs('customer-123', { page: 2, limit: 10 });

      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
    });
  });

  // ── retryJob ─────────────────────────────────────────────────────────────────

  describe('retryJob', () => {
    const failedEmailJob = makeJob({
      id: 'job-failed',
      type: JobType.EMAIL,
      status: JobStatus.FAILED,
      payload: { to: 'user@example.com', subject: 'Hello', body: '<p>Hi</p>' },
    });

    const failedWebhookJob = makeJob({
      id: 'job-failed',
      type: JobType.WEBHOOK,
      status: JobStatus.FAILED,
      payload: {
        url: 'https://example.com/hook',
        method: 'POST',
        headers: {},
        payload: { event: 'test' },
      },
    });

    it('should return null when the job is not found or not in FAILED status', async () => {
      prisma.job.findFirst.mockResolvedValue(null);

      const result = await service.retryJob('customer-123', 'job-missing');

      expect(result).toBeNull();
    });

    it('should throw BadRequestException when retrying an EMAIL job on a paid plan without a SendGrid key', async () => {
      prisma.job.findFirst.mockResolvedValue(failedEmailJob);
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.INDIE, sendgridApiKey: null }),
      );

      await expect(service.retryJob('customer-123', 'job-failed')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update the job status to PENDING and re-queue an EMAIL job', async () => {
      prisma.job.findFirst.mockResolvedValue(failedEmailJob);
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.FREE }),
      );
      prisma.job.update.mockResolvedValue({ ...failedEmailJob, status: JobStatus.PENDING });
      queueService.addEmailJob.mockResolvedValue(undefined);

      await service.retryJob('customer-123', 'job-failed');

      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-failed' },
        data: { status: JobStatus.PENDING, errorMessage: null },
      });
      expect(queueService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-failed',
          customerId: 'customer-123',
          to: 'user@example.com',
        }),
        failedEmailJob.priority,
        true,
      );
    });

    it('should update the job status to PENDING and re-queue a WEBHOOK job', async () => {
      prisma.job.findFirst.mockResolvedValue(failedWebhookJob);
      prisma.job.update.mockResolvedValue({ ...failedWebhookJob, status: JobStatus.PENDING });
      queueService.addWebhookJob.mockResolvedValue(undefined);

      await service.retryJob('customer-123', 'job-failed');

      expect(prisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-failed' },
        data: { status: JobStatus.PENDING, errorMessage: null },
      });
      expect(queueService.addWebhookJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-failed',
          url: 'https://example.com/hook',
          method: 'POST',
        }),
        failedWebhookJob.priority,
        true,
      );
    });

    it('should return the retry response with pending status', async () => {
      prisma.job.findFirst.mockResolvedValue(failedEmailJob);
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.FREE }),
      );
      prisma.job.update.mockResolvedValue(failedEmailJob);
      queueService.addEmailJob.mockResolvedValue(undefined);

      const result = await service.retryJob('customer-123', 'job-failed');

      expect(result).toEqual({
        jobId: 'job-failed',
        status: 'pending',
        message: 'Job has been re-queued for processing',
      });
    });
  });
});
