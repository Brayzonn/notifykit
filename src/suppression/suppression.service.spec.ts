import { Test, TestingModule } from '@nestjs/testing';
import { EmailEventType } from '@prisma/client';
import { SuppressionService } from './suppression.service';
import { PrismaService } from '@/prisma/prisma.service';

describe('SuppressionService', () => {
  let service: SuppressionService;
  const prisma = {
    suppressedRecipient: { upsert: jest.fn(), findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppressionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SuppressionService);
    prisma.suppressedRecipient.upsert.mockReset();
    prisma.suppressedRecipient.findUnique.mockReset();
  });

  describe('suppressFromEvent', () => {
    it('suppresses on spam complaints', async () => {
      await expect(
        service.suppressFromEvent({
          customerId: 'cust-1',
          email: 'a@b.com',
          eventType: EmailEventType.SPAM_REPORT,
        }),
      ).resolves.toBe(true);

      expect(prisma.suppressedRecipient.upsert).toHaveBeenCalledWith({
        where: { customerId_email: { customerId: 'cust-1', email: 'a@b.com' } },
        create: {
          customerId: 'cust-1',
          email: 'a@b.com',
          reason: EmailEventType.SPAM_REPORT,
        },
        update: { reason: EmailEventType.SPAM_REPORT },
      });
    });

    it('suppresses on hard bounces', async () => {
      await expect(
        service.suppressFromEvent({
          customerId: 'cust-1',
          email: 'a@b.com',
          eventType: EmailEventType.BOUNCED,
          hardBounce: true,
        }),
      ).resolves.toBe(true);

      expect(prisma.suppressedRecipient.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ reason: EmailEventType.BOUNCED }),
        }),
      );
    });

    it('ignores soft bounces', async () => {
      await expect(
        service.suppressFromEvent({
          customerId: 'cust-1',
          email: 'a@b.com',
          eventType: EmailEventType.BOUNCED,
          hardBounce: false,
        }),
      ).resolves.toBe(false);

      expect(prisma.suppressedRecipient.upsert).not.toHaveBeenCalled();
    });

    it.each([
      EmailEventType.DELIVERED,
      EmailEventType.OPENED,
      EmailEventType.DEFERRED,
      EmailEventType.UNSUBSCRIBED,
    ])('ignores %s even if hardBounce is set', async (eventType) => {
      await expect(
        service.suppressFromEvent({
          customerId: 'cust-1',
          email: 'a@b.com',
          eventType,
          hardBounce: true,
        }),
      ).resolves.toBe(false);

      expect(prisma.suppressedRecipient.upsert).not.toHaveBeenCalled();
    });

    it('ignores events without an email', async () => {
      await expect(
        service.suppressFromEvent({
          customerId: 'cust-1',
          email: '',
          eventType: EmailEventType.SPAM_REPORT,
        }),
      ).resolves.toBe(false);

      expect(prisma.suppressedRecipient.upsert).not.toHaveBeenCalled();
    });
  });

  describe('findSuppression', () => {
    it('looks up by the customer/email unique key', async () => {
      prisma.suppressedRecipient.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.findSuppression('cust-1', 'a@b.com'),
      ).resolves.toBeNull();

      expect(prisma.suppressedRecipient.findUnique).toHaveBeenCalledWith({
        where: { customerId_email: { customerId: 'cust-1', email: 'a@b.com' } },
      });
    });
  });
});
