import { Test, TestingModule } from '@nestjs/testing';
import { EmailEventType } from '@prisma/client';
import { ResendEventsService } from './resend-events.service';
import { PrismaService } from '@/prisma/prisma.service';

const baseEvent = (overrides: Record<string, any> = {}) => ({
  type: 'email.delivered',
  created_at: '2026-04-28T10:00:00Z',
  data: {
    email_id: 'rs-1',
    from: 'sender@example.com',
    to: ['a@b.com'],
    subject: 'hi',
    created_at: '2026-04-28T10:00:00Z',
    tags: { job_id: 'job-x' },
    ...((overrides.data as object) ?? {}),
  },
  ...overrides,
});

describe('ResendEventsService', () => {
  let service: ResendEventsService;
  const prisma = {
    job: { findUnique: jest.fn() },
    emailEvent: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResendEventsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ResendEventsService);
    prisma.job.findUnique.mockReset();
    prisma.emailEvent.upsert.mockReset();
  });

  it('ignores untracked Resend event types', async () => {
    await service.processEvent(baseEvent({ type: 'email.queued' }) as any);

    expect(prisma.job.findUnique).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('skips events with no job_id tag', async () => {
    await service.processEvent(baseEvent({ data: { tags: {} } }) as any);

    expect(prisma.job.findUnique).not.toHaveBeenCalled();
  });

  it('skips events with no tags object at all', async () => {
    await service.processEvent(baseEvent({ data: { tags: undefined } }) as any);

    expect(prisma.job.findUnique).not.toHaveBeenCalled();
  });

  it('warns and skips when the job does not exist', async () => {
    prisma.job.findUnique.mockResolvedValueOnce(null);

    await service.processEvent(baseEvent() as any);

    expect(prisma.job.findUnique).toHaveBeenCalledWith({
      where: { id: 'job-x' },
      select: { id: true },
    });
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('upserts using `${email_id}:${eventType}` as the dedupe key', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });
    prisma.emailEvent.upsert.mockResolvedValueOnce(undefined);

    await service.processEvent(baseEvent() as any);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith({
      where: { eventId: `rs-1:${EmailEventType.DELIVERED}` },
      create: expect.objectContaining({
        jobId: 'job-x',
        event: EmailEventType.DELIVERED,
        email: 'a@b.com',
        eventId: `rs-1:${EmailEventType.DELIVERED}`,
        occurredAt: new Date('2026-04-28T10:00:00Z'),
      }),
      update: {},
    });
  });

  it('parses occurredAt from the top-level created_at, not data.created_at', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent(
      baseEvent({
        created_at: '2026-04-28T11:00:00Z',
        data: {
          email_id: 'rs-2',
          from: 'sender@example.com',
          to: ['a@b.com'],
          subject: 'hi',
          created_at: '2099-01-01T00:00:00Z',
          tags: { job_id: 'job-x' },
        },
      }) as any,
    );

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          occurredAt: new Date('2026-04-28T11:00:00Z'),
        }),
      }),
    );
  });

  it('takes the first recipient when `to` is an array of multiple addresses', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent(
      baseEvent({
        data: {
          email_id: 'rs-3',
          from: 'sender@example.com',
          to: ['first@b.com', 'second@b.com'],
          subject: 'hi',
          created_at: '2026-04-28T10:00:00Z',
          tags: { job_id: 'job-x' },
        },
      }) as any,
    );

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ email: 'first@b.com' }),
      }),
    );
  });

  it.each([
    ['email.delivered', EmailEventType.DELIVERED],
    ['email.opened', EmailEventType.OPENED],
    ['email.clicked', EmailEventType.CLICKED],
    ['email.bounced', EmailEventType.BOUNCED],
    ['email.complained', EmailEventType.SPAM_REPORT],
    ['email.delivery_delayed', EmailEventType.DEFERRED],
  ])('maps %s to %s', async (rsType, expected) => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent(baseEvent({ type: rsType }) as any);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ event: expected }),
      }),
    );
  });

  it('strips email_id, tags, from, to, subject, created_at from metadata', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent(
      baseEvent({
        data: {
          email_id: 'rs-4',
          from: 'sender@example.com',
          to: ['a@b.com'],
          subject: 'hi',
          created_at: '2026-04-28T10:00:00Z',
          tags: { job_id: 'job-x' },
          custom_field: 'keep-me',
        },
      }) as any,
    );

    const upsertCall = prisma.emailEvent.upsert.mock.calls[0][0];
    expect(upsertCall.create.metadata).toEqual({ custom_field: 'keep-me' });
  });

  it('omits metadata when no extra fields remain', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent(baseEvent() as any);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ metadata: undefined }),
      }),
    );
  });

  it('swallows upsert errors so the webhook still 200s', async () => {
    prisma.job.findUnique.mockResolvedValueOnce({ id: 'job-x' });
    prisma.emailEvent.upsert.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.processEvent(baseEvent() as any),
    ).resolves.toBeUndefined();
  });
});
