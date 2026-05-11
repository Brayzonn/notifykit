import { Test, TestingModule } from '@nestjs/testing';
import { EmailEventType } from '@prisma/client';
import { SendgridEventsService } from './sendgrid-events.service';
import { PrismaService } from '@/prisma/prisma.service';

describe('SendgridEventsService', () => {
  let service: SendgridEventsService;
  const prisma = {
    job: { findUnique: jest.fn() },
    emailEvent: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendgridEventsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SendgridEventsService);
    prisma.job.findUnique.mockReset();
    prisma.emailEvent.upsert.mockReset();
  });

  it('returns early when called with a non-array payload', async () => {
    await service.processEvents(
      undefined as unknown as Parameters<typeof service.processEvents>[0],
    );
    await service.processEvents(
      {} as unknown as Parameters<typeof service.processEvents>[0],
    );

    expect(prisma.job.findUnique).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('skips events with an untracked event type', async () => {
    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'processed',
        sg_event_id: 'sg-1',
        job_id: 'job-x',
      },
    ]);

    expect(prisma.job.findUnique).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('skips events with no job_id custom arg', async () => {
    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'delivered',
        sg_event_id: 'sg-1',
      },
    ]);

    expect(prisma.job.findUnique).not.toHaveBeenCalled();
  });

  it('warns and skips when the job does not exist', async () => {
    prisma.job.findUnique.mockResolvedValueOnce(null);

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'delivered',
        sg_event_id: 'sg-1',
        job_id: 'job-x',
      },
    ]);

    expect(prisma.job.findUnique).toHaveBeenCalledWith({
      where: { id: 'job-x' },
      select: { id: true },
    });
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('upserts a DELIVERED event using sg_event_id as the dedupe key and ms timestamp', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });
    prisma.emailEvent.upsert.mockResolvedValueOnce(undefined);

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'delivered',
        sg_event_id: 'sg-evt-1',
        job_id: 'job-x',
        smtp_id: '<abc@sendgrid>',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith({
      where: { eventId: 'sg-evt-1' },
      create: {
        jobId: 'job-x',
        event: EmailEventType.DELIVERED,
        email: 'a@b.com',
        eventId: 'sg-evt-1',
        metadata: { smtp_id: '<abc@sendgrid>' },
        occurredAt: new Date(1700000000 * 1000),
      },
      update: {},
    });
  });

  it('synthesizes a dedupe key when sg_event_id is absent', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'open',
        job_id: 'job-x',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId: `job-x:${EmailEventType.OPENED}:1700000000`,
        },
      }),
    );
  });

  it.each([
    ['delivered', EmailEventType.DELIVERED],
    ['open', EmailEventType.OPENED],
    ['click', EmailEventType.CLICKED],
    ['bounce', EmailEventType.BOUNCED],
    ['spamreport', EmailEventType.SPAM_REPORT],
    ['unsubscribe', EmailEventType.UNSUBSCRIBED],
    ['deferred', EmailEventType.DEFERRED],
  ])('maps "%s" to %s', async (sgType, expected) => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: sgType,
        sg_event_id: `sg-${sgType}`,
        job_id: 'job-x',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ event: expected }),
      }),
    );
  });

  it('processes multiple events in a batch', async () => {
    prisma.job.findUnique.mockResolvedValue({ id: 'job-x' });

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'delivered',
        sg_event_id: 'sg-1',
        job_id: 'job-x',
      },
      {
        email: 'a@b.com',
        timestamp: 1700000010,
        event: 'open',
        sg_event_id: 'sg-2',
        job_id: 'job-x',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledTimes(2);
  });

  it('omits metadata when no extra fields remain', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'delivered',
        sg_event_id: 'sg-1',
        job_id: 'job-x',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ metadata: undefined }),
      }),
    );
  });

  it('swallows upsert errors so other events in the batch still process', async () => {
    prisma.job.findUnique.mockResolvedValue({ id: 'job-x' });
    prisma.emailEvent.upsert
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.processEvents([
        {
          email: 'a@b.com',
          timestamp: 1700000000,
          event: 'delivered',
          sg_event_id: 'sg-1',
          job_id: 'job-x',
        },
        {
          email: 'a@b.com',
          timestamp: 1700000010,
          event: 'open',
          sg_event_id: 'sg-2',
          job_id: 'job-x',
        },
      ]),
    ).resolves.toBeUndefined();

    expect(prisma.emailEvent.upsert).toHaveBeenCalledTimes(2);
  });
});
