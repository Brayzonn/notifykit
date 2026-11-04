import { Test, TestingModule } from '@nestjs/testing';
import { PostmarkEventsService } from './postmark-events.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SuppressionService } from '@/suppression/suppression.service';
import { EmailEventType } from '@prisma/client';

describe('PostmarkEventsService', () => {
  let service: PostmarkEventsService;
  const prisma = {
    job: { findFirst: jest.fn() },
    emailEvent: { upsert: jest.fn() },
  };
  const suppression = { suppressFromEvent: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostmarkEventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SuppressionService, useValue: suppression },
      ],
    }).compile();

    service = module.get(PostmarkEventsService);
    prisma.job.findFirst.mockReset();
    prisma.emailEvent.upsert.mockReset();
    suppression.suppressFromEvent.mockReset();
  });

  it('ignores untracked Postmark RecordTypes', async () => {
    await service.processEvent('cust-1', {
      RecordType: 'SubscriptionReminder',
    } as any);

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('skips events without job_id metadata', async () => {
    await service.processEvent('cust-1', {
      RecordType: 'Delivery',
      MessageID: 'm-1',
    } as any);

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('warns and exits when the job does not exist', async () => {
    prisma.job.findFirst.mockResolvedValueOnce(null);

    await service.processEvent('cust-1', {
      RecordType: 'Delivery',
      MessageID: 'm-1',
      Recipient: 'a@b.com',
      DeliveredAt: '2026-04-28T10:00:00Z',
      Metadata: { job_id: 'job-x' },
    } as any);

    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-x', customerId: 'cust-1' },
      select: { id: true, customerId: true },
    });
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('upserts a DELIVERED event using DeliveredAt as occurredAt', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });
    prisma.emailEvent.upsert.mockResolvedValueOnce(undefined);

    const occurredIso = '2026-04-28T10:00:00.000Z';
    await service.processEvent('cust-1', {
      RecordType: 'Delivery',
      MessageID: 'm-1',
      Recipient: 'a@b.com',
      DeliveredAt: occurredIso,
      Metadata: { job_id: 'job-x' },
      Tag: 'welcome',
    } as any);

    const expectedKey = `m-1:Delivery:${new Date(occurredIso).getTime()}`;
    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith({
      where: { eventId: expectedKey },
      create: {
        jobId: 'job-x',
        event: EmailEventType.DELIVERED,
        email: 'a@b.com',
        eventId: expectedKey,
        metadata: { Tag: 'welcome', SuppressSending: undefined },
        occurredAt: new Date(occurredIso),
      },
      update: {},
    });
  });

  it('maps SpamComplaint -> SPAM_REPORT and SubscriptionChange -> UNSUBSCRIBED', async () => {
    prisma.job.findFirst.mockResolvedValue({ id: 'job-x' });

    await service.processEvent('cust-1', {
      RecordType: 'SpamComplaint',
      MessageID: 'm-1',
      Email: 'a@b.com',
      BouncedAt: '2026-04-28T10:00:00Z',
      Metadata: { job_id: 'job-x' },
    } as any);
    await service.processEvent('cust-1', {
      RecordType: 'SubscriptionChange',
      MessageID: 'm-2',
      Recipient: 'a@b.com',
      ChangedAt: '2026-04-28T10:00:00Z',
      Metadata: { job_id: 'job-x' },
    } as any);

    const events = prisma.emailEvent.upsert.mock.calls.map(
      (c) => c[0].create.event,
    );
    expect(events).toEqual([
      EmailEventType.SPAM_REPORT,
      EmailEventType.UNSUBSCRIBED,
    ]);
  });

  it('falls back to Email field when Recipient is absent', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent('cust-1', {
      RecordType: 'Bounce',
      MessageID: 'm-1',
      Email: 'fallback@b.com',
      BouncedAt: '2026-04-28T10:00:00Z',
      Metadata: { job_id: 'job-x' },
    } as any);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ email: 'fallback@b.com' }),
      }),
    );
  });

  it('swallows upsert errors so the webhook still 200s', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });
    prisma.emailEvent.upsert.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.processEvent('cust-1', {
        RecordType: 'Delivery',
        MessageID: 'm-1',
        Recipient: 'a@b.com',
        DeliveredAt: '2026-04-28T10:00:00Z',
        Metadata: { job_id: 'job-x' },
      } as any),
    ).resolves.toBeUndefined();
  });

  describe('suppression', () => {
    const bounce = (Type: string, Inactive?: boolean) =>
      ({
        RecordType: 'Bounce',
        Type,
        Inactive,
        MessageID: 'm-1',
        Email: 'a@b.com',
        BouncedAt: '2026-04-28T10:00:00Z',
        Metadata: { job_id: 'job-x' },
      }) as any;

    it.each([
      ['HardBounce', true, true],
      ['BadEmailAddress', true, true],
      ['Blocked', false, false],
      ['SoftBounce', false, false],
      ['Transient', undefined, false],
    ])(
      'passes hardBounce for Type=%s Inactive=%s as %s',
      async (type, inactive, hard) => {
        prisma.job.findFirst.mockResolvedValueOnce({
          id: 'job-x',
          customerId: 'cust-1',
        });

        await service.processEvent('cust-1', bounce(type, inactive));

        expect(suppression.suppressFromEvent).toHaveBeenCalledWith({
          customerId: 'cust-1',
          email: 'a@b.com',
          eventType: EmailEventType.BOUNCED,
          hardBounce: hard,
        });
      },
    );

    it('does not suppress when the event fails to store', async () => {
      prisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-x',
        customerId: 'cust-1',
      });
      prisma.emailEvent.upsert.mockRejectedValueOnce(new Error('db down'));

      await service.processEvent('cust-1', bounce('HardBounce', true));

      expect(suppression.suppressFromEvent).not.toHaveBeenCalled();
    });
  });

  describe('shared platform route (no customerId)', () => {
    it('looks up the job without a customer scope and suppresses against its owner', async () => {
      prisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-x',
        customerId: 'owner-1',
      });

      await service.processEvent(undefined, {
        RecordType: 'Bounce',
        Type: 'HardBounce',
        Inactive: true,
        MessageID: 'm-1',
        Email: 'a@b.com',
        BouncedAt: '2026-04-28T10:00:00Z',
        Metadata: { job_id: 'job-x' },
      } as any);

      expect(prisma.job.findFirst).toHaveBeenCalledWith({
        where: { id: 'job-x' },
        select: { id: true, customerId: true },
      });
      expect(suppression.suppressFromEvent).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'owner-1', hardBounce: true }),
      );
    });

    it('skips events for unknown jobs', async () => {
      prisma.job.findFirst.mockResolvedValueOnce(null);

      await service.processEvent(undefined, {
        RecordType: 'Bounce',
        Type: 'HardBounce',
        Inactive: true,
        MessageID: 'm-1',
        Email: 'a@b.com',
        BouncedAt: '2026-04-28T10:00:00Z',
        Metadata: { job_id: 'job-x' },
      } as any);

      expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
      expect(suppression.suppressFromEvent).not.toHaveBeenCalled();
    });
  });
});
