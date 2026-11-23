import { Test, TestingModule } from '@nestjs/testing';
import { EmailEventType } from '@/generated/prisma/client';
import { SendgridEventsService } from './sendgrid-events.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SuppressionService } from '@/suppression/suppression.service';

describe('SendgridEventsService', () => {
  let service: SendgridEventsService;
  const prisma = {
    job: { findFirst: jest.fn() },
    emailEvent: { upsert: jest.fn() },
  };
  const suppression = { suppressFromEvent: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendgridEventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SuppressionService, useValue: suppression },
      ],
    }).compile();

    service = module.get(SendgridEventsService);
    prisma.job.findFirst.mockReset();
    prisma.emailEvent.upsert.mockReset();
    suppression.suppressFromEvent.mockReset();
  });

  it('returns early when called with a non-array payload', async () => {
    await service.processEvents(
      undefined as unknown as Parameters<typeof service.processEvents>[0],
    );
    await service.processEvents(
      {} as unknown as Parameters<typeof service.processEvents>[0],
    );

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('skips events with an untracked event type', async () => {
    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'processed',
        sg_event_id: 'sg-1',
        job_id: '11111111-1111-4111-8111-111111111111',
      },
    ]);

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
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

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it('warns and skips when the job does not exist', async () => {
    prisma.job.findFirst.mockResolvedValueOnce(null);

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'delivered',
        sg_event_id: 'sg-1',
        job_id: '11111111-1111-4111-8111-111111111111',
      },
    ]);

    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
      select: { id: true, customerId: true },
    });
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('scopes the job lookup to the customer on the per-customer BYOK path', async () => {
    prisma.job.findFirst.mockResolvedValueOnce(null);

    await service.processEvents(
      [
        {
          email: 'a@b.com',
          timestamp: 1700000000,
          event: 'delivered',
          sg_event_id: 'sg-1',
          job_id: '11111111-1111-4111-8111-111111111111',
        },
      ],
      'cust-1',
    );

    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: '11111111-1111-4111-8111-111111111111',
        customerId: 'cust-1',
      },
      select: { id: true, customerId: true },
    });
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('upserts a DELIVERED event using sg_event_id as the dedupe key and ms timestamp', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
    });
    prisma.emailEvent.upsert.mockResolvedValueOnce(undefined);

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'delivered',
        sg_event_id: 'sg-evt-1',
        job_id: '11111111-1111-4111-8111-111111111111',
        smtp_id: '<abc@sendgrid>',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith({
      where: { eventId: 'sg-evt-1' },
      create: {
        jobId: '11111111-1111-4111-8111-111111111111',
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
    prisma.job.findFirst.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
    });

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'open',
        job_id: '11111111-1111-4111-8111-111111111111',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId: `11111111-1111-4111-8111-111111111111:${EmailEventType.OPENED}:1700000000`,
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
    prisma.job.findFirst.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
    });

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: sgType,
        sg_event_id: `sg-${sgType}`,
        job_id: '11111111-1111-4111-8111-111111111111',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ event: expected }),
      }),
    );
  });

  it('processes multiple events in a batch', async () => {
    prisma.job.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
    });

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'delivered',
        sg_event_id: 'sg-1',
        job_id: '11111111-1111-4111-8111-111111111111',
      },
      {
        email: 'a@b.com',
        timestamp: 1700000010,
        event: 'open',
        sg_event_id: 'sg-2',
        job_id: '11111111-1111-4111-8111-111111111111',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledTimes(2);
  });

  it('omits metadata when no extra fields remain', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
    });

    await service.processEvents([
      {
        email: 'a@b.com',
        timestamp: 1700000000,
        event: 'delivered',
        sg_event_id: 'sg-1',
        job_id: '11111111-1111-4111-8111-111111111111',
      },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ metadata: undefined }),
      }),
    );
  });

  it('swallows upsert errors so other events in the batch still process', async () => {
    prisma.job.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
    });
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
          job_id: '11111111-1111-4111-8111-111111111111',
        },
        {
          email: 'a@b.com',
          timestamp: 1700000010,
          event: 'open',
          sg_event_id: 'sg-2',
          job_id: '11111111-1111-4111-8111-111111111111',
        },
      ]),
    ).resolves.toBeUndefined();

    expect(prisma.emailEvent.upsert).toHaveBeenCalledTimes(2);
  });

  describe('suppression', () => {
    const bounce = (type?: string) => ({
      email: 'a@b.com',
      timestamp: 1700000000,
      event: 'bounce',
      sg_event_id: 'sg-1',
      job_id: '11111111-1111-4111-8111-111111111111',
      ...(type ? { type } : {}),
    });

    it.each([
      ['bounce', true],
      ['blocked', false],
      [undefined, false],
    ])('passes hardBounce for type=%s as %s', async (type, hard) => {
      prisma.job.findFirst.mockResolvedValueOnce({
        id: '11111111-1111-4111-8111-111111111111',
        customerId: 'cust-1',
      });

      await service.processEvents([bounce(type)], 'cust-1');

      expect(suppression.suppressFromEvent).toHaveBeenCalledWith({
        customerId: 'cust-1',
        email: 'a@b.com',
        eventType: EmailEventType.BOUNCED,
        hardBounce: hard,
      });
    });

    it("suppresses against the job's owner on the shared platform route", async () => {
      prisma.job.findFirst.mockResolvedValueOnce({
        id: '11111111-1111-4111-8111-111111111111',
        customerId: 'owner-1',
      });

      await service.processEvents([bounce('bounce')]);

      expect(suppression.suppressFromEvent).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'owner-1' }),
      );
    });
  });
});
