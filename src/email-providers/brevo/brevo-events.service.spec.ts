import { Test, TestingModule } from '@nestjs/testing';
import { BrevoEventsService } from './brevo-events.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SuppressionService } from '@/suppression/suppression.service';
import { EmailEventType } from '@/generated/prisma/client';

describe('BrevoEventsService', () => {
  let service: BrevoEventsService;
  const prisma = {
    job: { findFirst: jest.fn() },
    emailEvent: { upsert: jest.fn() },
  };
  const suppression = { suppressFromEvent: jest.fn() };

  const delivered = {
    event: 'delivered',
    email: 'a@b.com',
    'message-id': '<m-1@relay>',
    ts_event: 1764000000,
    tags: ['job_id:11111111-1111-4111-8111-111111111111'],
    subject: 'Hello',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrevoEventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SuppressionService, useValue: suppression },
      ],
    }).compile();

    service = module.get(BrevoEventsService);
    prisma.job.findFirst.mockReset();
    prisma.emailEvent.upsert.mockReset();
    suppression.suppressFromEvent.mockReset();
  });

  it('ignores untracked event types', async () => {
    await service.processEvents('cust-1', { event: 'request' });

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it('skips events without a job id', async () => {
    await service.processEvents('cust-1', {
      event: 'delivered',
      email: 'a@b.com',
    });

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it('scopes the job lookup to the customer and skips unknown jobs', async () => {
    prisma.job.findFirst.mockResolvedValueOnce(null);

    await service.processEvents('cust-1', delivered);

    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: '11111111-1111-4111-8111-111111111111',
        customerId: 'cust-1',
      },
      select: { id: true, customerId: true },
    });
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('does not scope the job lookup on the platform route', async () => {
    prisma.job.findFirst.mockResolvedValueOnce(null);

    await service.processEvents(undefined, delivered);

    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
      select: { id: true, customerId: true },
    });
  });

  it('records a DELIVERED event with a dedupe key and ts_event time', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      customerId: 'cust-1',
    });

    await service.processEvents('cust-1', delivered);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledWith({
      where: { eventId: '<m-1@relay>:delivered:1764000000' },
      create: {
        jobId: '11111111-1111-4111-8111-111111111111',
        event: EmailEventType.DELIVERED,
        email: 'a@b.com',
        eventId: '<m-1@relay>:delivered:1764000000',
        metadata: { subject: 'Hello' },
        occurredAt: new Date(1764000000 * 1000),
      },
      update: {},
    });
  });

  it('ignores X-Mailin-custom values set by other systems', async () => {
    await service.processEvents('cust-1', {
      event: 'opened',
      email: 'a@b.com',
      'X-Mailin-custom': '22222222-2222-4222-8222-222222222222',
    });

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
  });

  it('skips a job_id tag that is not a UUID without querying', async () => {
    await service.processEvents('cust-1', {
      ...delivered,
      tags: ['job_id:order-991'],
    });

    expect(prisma.job.findFirst).not.toHaveBeenCalled();
    expect(prisma.emailEvent.upsert).not.toHaveBeenCalled();
  });

  it('processes batched arrays', async () => {
    prisma.job.findFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      customerId: 'cust-1',
    });

    await service.processEvents('cust-1', [
      delivered,
      { ...delivered, event: 'click', ts_event: 1764000100 },
    ]);

    expect(prisma.emailEvent.upsert).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['hard_bounce', EmailEventType.BOUNCED, true],
    ['invalid_email', EmailEventType.BOUNCED, true],
    ['soft_bounce', EmailEventType.BOUNCED, false],
    ['spam', EmailEventType.SPAM_REPORT, false],
  ])('passes %s to suppression', async (event, eventType, hardBounce) => {
    prisma.job.findFirst.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      customerId: 'cust-1',
    });

    await service.processEvents(undefined, { ...delivered, event });

    expect(suppression.suppressFromEvent).toHaveBeenCalledWith({
      customerId: 'cust-1',
      email: 'a@b.com',
      eventType,
      hardBounce,
    });
  });
});
