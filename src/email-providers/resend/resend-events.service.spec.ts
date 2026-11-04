import { Test, TestingModule } from '@nestjs/testing';
import { EmailEventType } from '@prisma/client';
import { ResendEventsService } from './resend-events.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SuppressionService } from '@/suppression/suppression.service';

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
    job: { findFirst: jest.fn() },
    emailEvent: { upsert: jest.fn() },
  };
  const suppression = { suppressFromEvent: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResendEventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SuppressionService, useValue: suppression },
      ],
    }).compile();

    service = module.get(ResendEventsService);
    prisma.job.findFirst.mockReset();
    prisma.emailEvent.upsert.mockReset();
    suppression.suppressFromEvent.mockReset();
  });

  it('ignores untracked Resend event types', async () => {
    await service.processEvent(
      'cust-1',
      baseEvent({ type: 'email.queued' }) as any,
    );

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('skips events with no job_id tag', async () => {
    await service.processEvent(
      'cust-1',
      baseEvent({ data: { tags: {} } }) as any,
    );

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it('skips events with no tags object at all', async () => {
    await service.processEvent(
      'cust-1',
      baseEvent({ data: { tags: undefined } }) as any,
    );

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it('warns and skips when the job does not exist', async () => {
    prisma.job.findFirst.mockResolvedValueOnce(null);

    await service.processEvent('cust-1', baseEvent() as any);

    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-x', customerId: 'cust-1' },
      select: { id: true, customerId: true },
    });
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('upserts using `${email_id}:${eventType}` as the dedupe key', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });
    prisma.emailEvent.upsert.mockResolvedValueOnce(undefined);

    await service.processEvent('cust-1', baseEvent() as any);

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
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent(
      'cust-1',
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
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent(
      'cust-1',
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
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent('cust-1', baseEvent({ type: rsType }) as any);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ event: expected }),
      }),
    );
  });

  it('strips email_id, tags, from, to, subject, created_at from metadata', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent(
      'cust-1',
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
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });

    await service.processEvent('cust-1', baseEvent() as any);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ metadata: undefined }),
      }),
    );
  });

  it('swallows upsert errors so the webhook still 200s', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({ id: 'job-x' });
    prisma.emailEvent.upsert.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.processEvent('cust-1', baseEvent() as any),
    ).resolves.toBeUndefined();
  });

  describe('suppression', () => {
    it.each([
      ['Permanent', true],
      ['Transient', false],
      ['Undetermined', false],
    ])('passes hardBounce for bounce.type=%s as %s', async (type, hard) => {
      prisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-x',
        customerId: 'cust-1',
      });

      await service.processEvent('cust-1', {
        ...baseEvent({ type: 'email.bounced' }),
        data: { ...baseEvent().data, bounce: { type } },
      } as any);

      expect(suppression.suppressFromEvent).toHaveBeenCalledWith({
        customerId: 'cust-1',
        email: 'a@b.com',
        eventType: EmailEventType.BOUNCED,
        hardBounce: hard,
      });
    });

    it('forwards complaints as SPAM_REPORT', async () => {
      prisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-x',
        customerId: 'cust-1',
      });

      await service.processEvent(
        'cust-1',
        baseEvent({ type: 'email.complained' }) as any,
      );

      expect(suppression.suppressFromEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EmailEventType.SPAM_REPORT }),
      );
    });
  });

  describe('shared platform route (no customerId)', () => {
    it('looks up the job without a customer scope and suppresses against its owner', async () => {
      prisma.job.findFirst.mockResolvedValueOnce({
        id: 'job-x',
        customerId: 'owner-1',
      });

      await service.processEvent(undefined, {
        ...baseEvent({ type: 'email.bounced' }),
        data: { ...baseEvent().data, bounce: { type: 'Permanent' } },
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
        ...baseEvent({ type: 'email.bounced' }),
        data: { ...baseEvent().data, bounce: { type: 'Permanent' } },
      } as any);

      expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
      expect(suppression.suppressFromEvent).not.toHaveBeenCalled();
    });
  });
});
