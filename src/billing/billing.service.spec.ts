import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentService } from '@/payment/payment.service';
import { RedisService } from '@/redis/redis.service';
import { createMockCustomer } from '../../test/helpers/mock-factories';
import {
  createMockPrismaService,
  type MockedPrismaService,
} from '../../test/helpers/test-utils';
import { CustomerPlan, PaymentProvider, SubscriptionStatus } from '@prisma/client';
import { PLAN_LIMITS } from '@/common/constants/plans.constants';

type MockedPaymentService = {
  createCheckoutSession: jest.Mock;
  cancelSubscription: jest.Mock;
  getInvoices: jest.Mock;
};

type MockedRedisService = {
  del: jest.Mock;
};

describe('BillingService', () => {
  let service: BillingService;
  let prisma: MockedPrismaService;
  let paymentService: MockedPaymentService;
  let redis: MockedRedisService;

  const mockPaymentService: MockedPaymentService = {
    createCheckoutSession: jest.fn(),
    cancelSubscription: jest.fn(),
    getInvoices: jest.fn(),
  };

  const mockRedisService: MockedRedisService = {
    del: jest.fn(),
  };

  const mockPrismaService = createMockPrismaService();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    prisma = module.get(PrismaService);
    paymentService = module.get(PaymentService);
    redis = module.get(RedisService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ── createUpgradeCheckout ────────────────────────────────────────────────────

  describe('createUpgradeCheckout', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when already on the target plan', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.INDIE }),
      );

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE),
      ).rejects.toThrow('Already on this plan');
    });

    it('should throw BadRequestException when downgrading an ACTIVE subscription', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.STARTUP,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
        }),
      );

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE),
      ).rejects.toThrow('Please cancel current subscription to downgrade');
    });

    it('should use the waiting message when downgrading a CANCELLED (not yet expired) subscription', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.STARTUP,
          subscriptionStatus: SubscriptionStatus.CANCELLED,
          subscriptionEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }),
      );

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE),
      ).rejects.toThrow(
        'Please wait until your current subscription expires before subscribing to a lower plan',
      );
    });

    it('should allow downgrade when subscription status is EXPIRED', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.STARTUP,
          subscriptionStatus: SubscriptionStatus.EXPIRED,
        }),
      );
      paymentService.createCheckoutSession.mockResolvedValue('https://checkout.url');

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE),
      ).resolves.toBeDefined();

      expect(paymentService.createCheckoutSession).toHaveBeenCalled();
    });

    it('should allow downgrade when subscription status is PAST_DUE', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.STARTUP,
          subscriptionStatus: SubscriptionStatus.PAST_DUE,
        }),
      );
      paymentService.createCheckoutSession.mockResolvedValue('https://checkout.url');

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE),
      ).resolves.toBeDefined();
    });

    it('should auto-downgrade a CANCELLED+expired subscription then create checkout', async () => {
      const expiredCustomer = createMockCustomer({
        plan: CustomerPlan.STARTUP,
        subscriptionStatus: SubscriptionStatus.CANCELLED,
        subscriptionEndDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      // First call: createUpgradeCheckout fetches the customer
      // Second call: downgradeToFreePlan fetches by id with select
      prisma.customer.findUnique
        .mockResolvedValueOnce(expiredCustomer)
        .mockResolvedValueOnce({ plan: CustomerPlan.STARTUP, email: expiredCustomer.email });

      paymentService.createCheckoutSession.mockResolvedValue('https://checkout.url');

      await service.createUpgradeCheckout('user-123', CustomerPlan.INDIE);

      // downgradeToFreePlan must have run (two findUnique + one update)
      expect(prisma.customer.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.customer.update).toHaveBeenCalled();
      // Checkout must have been created (INDIE is now an upgrade from FREE)
      expect(paymentService.createCheckoutSession).toHaveBeenCalled();
    });

    it('should return checkout URL, plan, and price', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.FREE }),
      );
      paymentService.createCheckoutSession.mockResolvedValue('https://checkout.url/session');

      const result = await service.createUpgradeCheckout('user-123', CustomerPlan.INDIE);

      expect(result).toEqual({
        checkoutUrl: 'https://checkout.url/session',
        plan: CustomerPlan.INDIE,
        price: PLAN_LIMITS[CustomerPlan.INDIE].price,
      });
    });
  });

  // ── cancelSubscription ───────────────────────────────────────────────────────

  describe('cancelSubscription', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.cancelSubscription('user-123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for a FREE plan customer', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.FREE }),
      );

      await expect(service.cancelSubscription('user-123')).rejects.toThrow(
        'No active subscription to cancel',
      );
    });

    it('should throw BadRequestException when no providerSubscriptionId', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.INDIE,
          providerSubscriptionId: null,
        }),
      );

      await expect(service.cancelSubscription('user-123')).rejects.toThrow(
        'No subscription found',
      );
    });

    it('should throw BadRequestException when no paymentProvider', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.INDIE,
          providerSubscriptionId: 'sub_123',
          paymentProvider: null,
        }),
      );

      await expect(service.cancelSubscription('user-123')).rejects.toThrow(
        'No payment provider found',
      );
    });

    it('should cancel the subscription and return the effective-until date', async () => {
      const nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const customer = createMockCustomer({
        plan: CustomerPlan.INDIE,
        providerSubscriptionId: 'sub_123',
        paymentProvider: PaymentProvider.STRIPE,
        nextBillingDate,
      });

      prisma.customer.findUnique.mockResolvedValue(customer);
      paymentService.cancelSubscription.mockResolvedValue(undefined);
      prisma.customer.update.mockResolvedValue({
        ...customer,
        subscriptionStatus: SubscriptionStatus.CANCELLED,
        subscriptionEndDate: nextBillingDate,
      });

      const result = await service.cancelSubscription('user-123');

      expect(paymentService.cancelSubscription).toHaveBeenCalledWith('sub_123');
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: customer.id },
        data: {
          subscriptionStatus: SubscriptionStatus.CANCELLED,
          previousPlan: CustomerPlan.INDIE,
          downgradedAt: expect.any(Date),
          nextBillingDate: null,
          subscriptionEndDate: nextBillingDate,
        },
      });
      expect(result).toEqual({
        message: 'Subscription cancelled successfully',
        effectiveUntil: nextBillingDate,
      });
    });
  });

  // ── getSubscriptionDetails ───────────────────────────────────────────────────

  describe('getSubscriptionDetails', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.getSubscriptionDetails('user-123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return subscription details', async () => {
      const customer = createMockCustomer({
        plan: CustomerPlan.INDIE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        nextBillingDate: new Date('2026-03-23'),
        paymentProvider: PaymentProvider.STRIPE,
        monthlyLimit: PLAN_LIMITS[CustomerPlan.INDIE].monthlyLimit,
      });

      prisma.customer.findUnique.mockResolvedValue(customer);

      const result = await service.getSubscriptionDetails('user-123');

      expect(result).toEqual({
        plan: CustomerPlan.INDIE,
        status: SubscriptionStatus.ACTIVE,
        nextBillingDate: new Date('2026-03-23'),
        subscriptionEndDate: null,
        paymentProvider: PaymentProvider.STRIPE,
        monthlyLimit: PLAN_LIMITS[CustomerPlan.INDIE].monthlyLimit,
      });
    });
  });

  // ── getInvoices ──────────────────────────────────────────────────────────────

  describe('getInvoices', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.getInvoices('user-123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return empty invoices when no provider is linked', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ providerCustomerId: null, paymentProvider: null }),
      );

      const result = await service.getInvoices('user-123');

      expect(result).toEqual({ invoices: [] });
      expect(paymentService.getInvoices).not.toHaveBeenCalled();
    });

    it('should delegate to paymentService and return invoices', async () => {
      const mockInvoices = [{ id: 'in_1', amount: 2900 }];
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          providerCustomerId: 'cus_123',
          paymentProvider: PaymentProvider.STRIPE,
        }),
      );
      paymentService.getInvoices.mockResolvedValue(mockInvoices);

      const result = await service.getInvoices('user-123');

      expect(paymentService.getInvoices).toHaveBeenCalledWith(
        'cus_123',
        PaymentProvider.STRIPE,
      );
      expect(result).toEqual({ invoices: mockInvoices });
    });
  });

  // ── handleSubscriptionActivated ──────────────────────────────────────────────

  describe('handleSubscriptionActivated', () => {
    const subscriptionData = {
      providerSubscriptionId: 'sub_123',
      providerCustomerId: 'cus_123',
      plan: CustomerPlan.INDIE,
      paymentProvider: PaymentProvider.STRIPE,
      nextBillingDate: new Date('2026-03-23'),
    };

    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.handleSubscriptionActivated('customer-123', subscriptionData),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update the customer with plan, limits, and ACTIVE status', async () => {
      const customer = createMockCustomer({ userId: 'user-123' });
      prisma.customer.findUnique.mockResolvedValue(customer);

      await service.handleSubscriptionActivated('customer-123', subscriptionData);

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-123' },
        data: expect.objectContaining({
          plan: CustomerPlan.INDIE,
          monthlyLimit: PLAN_LIMITS[CustomerPlan.INDIE].monthlyLimit,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          paymentProvider: PaymentProvider.STRIPE,
          providerCustomerId: 'cus_123',
          providerSubscriptionId: 'sub_123',
          nextBillingDate: new Date('2026-03-23'),
          lastPaymentDate: expect.any(Date),
        }),
      });
    });

    it('should use nextBillingDate as usageResetAt when provided', async () => {
      prisma.customer.findUnique.mockResolvedValue(createMockCustomer());

      await service.handleSubscriptionActivated('customer-123', subscriptionData);

      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            usageResetAt: new Date('2026-03-23'),
          }),
        }),
      );
    });

    it('should fall back to a computed date when nextBillingDate is null', async () => {
      prisma.customer.findUnique.mockResolvedValue(createMockCustomer());
      const before = Date.now();

      await service.handleSubscriptionActivated('customer-123', {
        ...subscriptionData,
        nextBillingDate: null,
      });

      const updateCall = prisma.customer.update.mock.calls[0][0];
      const usageResetAt: Date = updateCall.data.usageResetAt;

      expect(usageResetAt.getTime()).toBeGreaterThan(before);
    });

    it('should invalidate the Redis user cache', async () => {
      const customer = createMockCustomer({ userId: 'user-abc' });
      prisma.customer.findUnique.mockResolvedValue(customer);

      await service.handleSubscriptionActivated('customer-123', subscriptionData);

      expect(redis.del).toHaveBeenCalledWith('user:user-abc');
    });
  });

  // ── handleSubscriptionCancelled ──────────────────────────────────────────────

  describe('handleSubscriptionCancelled', () => {
    it('should warn and return without throwing when customer is not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const loggerSpy = jest.spyOn(service['logger'], 'warn');
      await expect(
        service.handleSubscriptionCancelled('sub_unknown'),
      ).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('sub_unknown'),
      );
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('should mark the subscription as CANCELLED', async () => {
      const customer = createMockCustomer({ providerSubscriptionId: 'sub_123' });
      prisma.customer.findFirst.mockResolvedValue(customer);

      await service.handleSubscriptionCancelled('sub_123');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: customer.id },
        data: { subscriptionStatus: SubscriptionStatus.CANCELLED },
      });
    });
  });

  // ── handleSubscriptionExpired ────────────────────────────────────────────────

  describe('handleSubscriptionExpired', () => {
    it('should warn and return without throwing when customer is not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const loggerSpy = jest.spyOn(service['logger'], 'warn');
      await expect(
        service.handleSubscriptionExpired('sub_unknown'),
      ).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('sub_unknown'),
      );
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('should reset the customer to the FREE plan with EXPIRED status', async () => {
      const customer = createMockCustomer({
        plan: CustomerPlan.INDIE,
        providerSubscriptionId: 'sub_123',
      });
      prisma.customer.findFirst.mockResolvedValue(customer);

      await service.handleSubscriptionExpired('sub_123');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: customer.id },
        data: expect.objectContaining({
          plan: CustomerPlan.FREE,
          monthlyLimit: PLAN_LIMITS[CustomerPlan.FREE].monthlyLimit,
          usageCount: 0,
          previousPlan: CustomerPlan.INDIE,
          subscriptionStatus: SubscriptionStatus.EXPIRED,
          downgradedAt: expect.any(Date),
          usageResetAt: expect.any(Date),
          billingCycleStartAt: expect.any(Date),
        }),
      });
    });
  });

  // ── downgradeToFreePlan ──────────────────────────────────────────────────────

  describe('downgradeToFreePlan', () => {
    it('should throw when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.downgradeToFreePlan('customer-123', 'SUBSCRIPTION_EXPIRED'),
      ).rejects.toThrow('Customer not found');
    });

    it('should update to FREE plan, reset usage, and set EXPIRED status', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        plan: CustomerPlan.INDIE,
        email: 'customer@example.com',
      });

      await service.downgradeToFreePlan('customer-123', 'SUBSCRIPTION_EXPIRED');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-123' },
        data: expect.objectContaining({
          plan: CustomerPlan.FREE,
          monthlyLimit: PLAN_LIMITS[CustomerPlan.FREE].monthlyLimit,
          usageCount: 0,
          previousPlan: CustomerPlan.INDIE,
          subscriptionStatus: SubscriptionStatus.EXPIRED,
          downgradedAt: expect.any(Date),
          usageResetAt: expect.any(Date),
          billingCycleStartAt: expect.any(Date),
        }),
      });
    });
  });

  // ── resetMonthlyUsage ────────────────────────────────────────────────────────

  describe('resetMonthlyUsage', () => {
    it('should reset usageCount to 0 and set usageResetAt 30 days from now', async () => {
      const before = Date.now();

      await service.resetMonthlyUsage('customer-123');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-123' },
        data: expect.objectContaining({
          usageCount: 0,
          usageResetAt: expect.any(Date),
          billingCycleStartAt: expect.any(Date),
        }),
      });

      const updateCall = prisma.customer.update.mock.calls[0][0];
      const resetAt: Date = updateCall.data.usageResetAt;
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;

      expect(resetAt.getTime()).toBeGreaterThanOrEqual(before + thirtyDays - 1000);
      expect(resetAt.getTime()).toBeLessThanOrEqual(Date.now() + thirtyDays + 1000);
    });
  });

  // ── incrementUsage ───────────────────────────────────────────────────────────

  describe('incrementUsage', () => {
    it('should increment the usageCount by 1', async () => {
      await service.incrementUsage('customer-123');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-123' },
        data: { usageCount: { increment: 1 } },
      });
    });
  });
});
