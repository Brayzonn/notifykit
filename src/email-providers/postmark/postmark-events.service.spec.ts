import { Test, TestingModule } from '@nestjs/testing';
import { PostmarkEventsService } from './postmark-events.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailEventType } from '@prisma/client';

describe('PostmarkEventsService', () => {
  let service: PostmarkEventsService;
  const prisma = {
    job: { findUnique: jest.fn() },
    emailEvent: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostmarkEventsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PostmarkEventsService);
    prisma.job.findUnique.mockReset();
    prisma.emailEvent.upsert.mockReset();
  });

  it('ignores untracked Postmark RecordTypes', async () => {
    await service.processEvent({ RecordType: 'SubscriptionReminder' } as any);

    expect(prisma.job.findUnique).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('skips events without job_id metadata', async () => {
    await service.processEvent({
      RecordType: 'Delivery',
      MessageID: 'm-1',
    } as any);

    expect(prisma.job.findUnique).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('warns and exits when the job does not exist', async () => {
    prisma.job.findUnique.mockResolvedValueOnce(null);

    await service.processEvent({
      RecordType: 'Delivery',
      MessageID: 'm-1',
      Recipient: 'a@b.com',
      DeliveredAt: '2026-04-28T10:00:00Z',
      Metadata: { job_id: 'job-x' },
    } as any);

    expect(prisma.job.findUnique).toHaveBeenCalledWith({
      where: { id: 'job-x' },
      select: { id: true },
    });
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('upserts a DELIVERED event using DeliveredAt as occurredAt', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });
    prisma.emailEvent.upsert.mockResolvedValueOnce(undefined);

    const occurredIso = '2026-04-28T10:00:00.000Z';
    await service.processEvent({
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
    prisma.job.findUnique.mockResolvedValue({ id: 'job-x' });

    await service.processEvent({
      RecordType: 'SpamComplaint',
      MessageID: 'm-1',
      Email: 'a@b.com',
      BouncedAt: '2026-04-28T10:00:00Z',
      Metadata: { job_id: 'job-x' },
    } as any);
    await service.processEvent({
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
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent({
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
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });
    prisma.emailEvent.upsert.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.processEvent({
        RecordType: 'Delivery',
        MessageID: 'm-1',
        Recipient: 'a@b.com',
        DeliveredAt: '2026-04-28T10:00:00Z',
        Metadata: { job_id: 'job-x' },
      } as any),
    ).resolves.toBeUndefined();
  });
});
