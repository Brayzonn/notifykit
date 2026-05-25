import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentService } from '@/payment/payment.service';
import { RedisService } from '@/redis/redis.service';
import { EmailService } from '@/platform-email/email.service';
import { createMockCustomer } from '../../test/helpers/mock-factories';
import {
  createMockPrismaService,
  createMockEmailService,
  type MockedPrismaService,
  type MockedEmailService,
} from '../../test/helpers/test-utils';
import { CustomerPlan, PaymentProvider, SubscriptionStatus } from '@prisma/client';
import { PLAN_LIMITS } from '@/common/constants/plans.constants';

type MockedPaymentService = {
  createCheckoutSession: jest.Mock;
  cancelSubscription: jest.Mock;
  getInvoices: jest.Mock;
  getSubscriptionStatus: jest.Mock;
};

type MockedRedisService = {
  del: jest.Mock;
  getClient: jest.Mock;
};

describe('BillingService', () => {
  let service: BillingService;
  let prisma: MockedPrismaService;
  let paymentService: MockedPaymentService;
  let redis: MockedRedisService;
  let emailService: MockedEmailService;

  const mockPaymentService: MockedPaymentService = {
    createCheckoutSession: jest.fn(),
    cancelSubscription: jest.fn(),
    getInvoices: jest.fn(),
    getSubscriptionStatus: jest.fn(),
  };

  const mockRedisService: MockedRedisService = {
    del: jest.fn(),
    getClient: jest.fn(),
  };

  const mockPrismaService = createMockPrismaService();
  const mockEmailService = createMockEmailService();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    prisma = module.get(PrismaService);
    paymentService = module.get(PaymentService);
    redis = module.get(RedisService);
    emailService = module.get(EmailService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ── createUpgradeCheckout ────────────────────────────────────────────────────

  describe('createUpgradeCheckout', () => {
    it('should throw NotFoundException when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'NGN'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when already on the target plan', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({ plan: CustomerPlan.INDIE }),
      );

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'NGN'),
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
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'NGN'),
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
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'NGN'),
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
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'NGN'),
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
        service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'NGN'),
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

      await service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'NGN');

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

      const result = await service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'NGN');

      expect(result).toEqual({
        checkoutUrl: 'https://checkout.url/session',
        plan: CustomerPlan.INDIE,
        price: PLAN_LIMITS[CustomerPlan.INDIE].price,
      });
    });

    it('should return null checkoutUrl for an inline Polar upgrade', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.INDIE,
          paymentProvider: PaymentProvider.POLAR,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          providerSubscriptionId: 'polar-sub-123',
        }),
      );
      paymentService.createCheckoutSession.mockResolvedValue(null);

      const result = await service.createUpgradeCheckout('user-123', CustomerPlan.STARTUP, 'USD');

      expect(result.checkoutUrl).toBeNull();
    });

    it('should pass providerSubscriptionId when provider is POLAR and status is ACTIVE', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.INDIE,
          paymentProvider: PaymentProvider.POLAR,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          providerSubscriptionId: 'polar-sub-123',
        }),
      );
      paymentService.createCheckoutSession.mockResolvedValue(null);

      await service.createUpgradeCheckout('user-123', CustomerPlan.STARTUP, 'USD');

      expect(paymentService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: 'polar-sub-123' }),
      );
    });

    it('should pass null providerSubscriptionId when POLAR subscription is not ACTIVE', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.FREE,
          paymentProvider: PaymentProvider.POLAR,
          subscriptionStatus: SubscriptionStatus.EXPIRED,
          providerSubscriptionId: 'polar-sub-old',
        }),
      );
      paymentService.createCheckoutSession.mockResolvedValue('https://checkout.url');

      await service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'USD');

      expect(paymentService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: null }),
      );
    });

    it('should pass null providerSubscriptionId for a Paystack customer upgrading via NGN', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.FREE,
          paymentProvider: PaymentProvider.PAYSTACK,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          providerSubscriptionId: 'ps-sub-123',
        }),
      );
      paymentService.createCheckoutSession.mockResolvedValue('https://checkout.url');

      await service.createUpgradeCheckout('user-123', CustomerPlan.INDIE, 'NGN');

      expect(paymentService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ providerSubscriptionId: null }),
      );
    });

    it('should block NGN upgrade when an active Polar subscription exists', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.INDIE,
          paymentProvider: PaymentProvider.POLAR,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
        }),
      );

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.STARTUP, 'NGN'),
      ).rejects.toThrow(
        'You have an active subscription on a different billing method. Please cancel it before switching.',
      );
    });

    it('should block USD upgrade when an active Paystack subscription exists', async () => {
      prisma.customer.findUnique.mockResolvedValue(
        createMockCustomer({
          plan: CustomerPlan.INDIE,
          paymentProvider: PaymentProvider.PAYSTACK,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
        }),
      );

      await expect(
        service.createUpgradeCheckout('user-123', CustomerPlan.STARTUP, 'USD'),
      ).rejects.toThrow(
        'You have an active subscription on a different billing method. Please cancel it before switching.',
      );
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
      prisma.customer.findUnique.mockResolvedValue(null);

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
      prisma.customer.findUnique.mockResolvedValue(customer);

      await service.handleSubscriptionCancelled('sub_123');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: customer.id },
        data: expect.objectContaining({
          subscriptionStatus: SubscriptionStatus.CANCELLED,
        }),
      });
    });
  });

  // ── handleSubscriptionExpired ────────────────────────────────────────────────

  describe('handleSubscriptionExpired', () => {
    it('should warn and return without throwing when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

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
      prisma.customer.findUnique.mockResolvedValue(customer);

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

  // ── handleRenewalCharge ──────────────────────────────────────────────────────

  describe('handleRenewalCharge', () => {
    it('should warn and return without throwing when customer is not found', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      const loggerSpy = jest.spyOn(service['logger'], 'warn');
      await expect(
        service.handleRenewalCharge('customer-123', new Date()),
      ).resolves.toBeNull();

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('customer-123'));
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('should update billing dates, reset usage, and invalidate cache', async () => {
      const nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const customer = createMockCustomer({ userId: 'user-abc' });
      prisma.customer.findUnique.mockResolvedValue(customer);

      await service.handleRenewalCharge(customer.id, nextBillingDate);

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: customer.id },
        data: expect.objectContaining({
          lastPaymentDate: expect.any(Date),
          nextBillingDate,
          subscriptionEndDate: nextBillingDate,
          usageResetAt: nextBillingDate,
          billingCycleStartAt: expect.any(Date),
          usageCount: 0,
        }),
      });
      expect(redis.del).toHaveBeenCalledWith('user:user-abc');
    });

    it('should fall back to +30 days when nextBillingDate is null', async () => {
      const customer = createMockCustomer({ userId: 'user-abc' });
      prisma.customer.findUnique.mockResolvedValue(customer);
      const before = Date.now();

      await service.handleRenewalCharge(customer.id, null);

      const updateCall = prisma.customer.update.mock.calls[0][0];
      const nextBillingDate: Date = updateCall.data.nextBillingDate;
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;

      expect(nextBillingDate.getTime()).toBeGreaterThanOrEqual(before + thirtyDays - 1000);
    });
  });

  // ── resolveProviderCycle ─────────────────────────────────────────────────────

  describe('resolveProviderCycle', () => {
    it('returns RENEWED when active with a future period end', async () => {
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      paymentService.getSubscriptionStatus.mockResolvedValue({
        status: 'active',
        isActive: true,
        currentPeriodEnd: periodEnd,
      });

      const result = await service.resolveProviderCycle('sub_1', 'POLAR');

      expect(result).toEqual({ action: 'RENEWED', periodEnd });
    });

    it('returns ACTIVE when active but the period end is not in the future', async () => {
      paymentService.getSubscriptionStatus.mockResolvedValue({
        status: 'active',
        isActive: true,
        currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      const result = await service.resolveProviderCycle('sub_1', 'PAYSTACK');

      expect(result).toEqual({ action: 'ACTIVE' });
    });

    it('returns ACTIVE when active with a null period end', async () => {
      paymentService.getSubscriptionStatus.mockResolvedValue({
        status: 'active',
        isActive: true,
        currentPeriodEnd: null,
      });

      const result = await service.resolveProviderCycle('sub_1', 'PAYSTACK');

      expect(result).toEqual({ action: 'ACTIVE' });
    });

    it('returns LAPSED when the provider reports not active', async () => {
      paymentService.getSubscriptionStatus.mockResolvedValue({
        status: 'cancelled',
        isActive: false,
        currentPeriodEnd: null,
      });

      const result = await service.resolveProviderCycle('sub_1', 'POLAR');

      expect(result).toEqual({ action: 'LAPSED' });
    });

    it('returns UNKNOWN when the subscription cannot be read (null)', async () => {
      paymentService.getSubscriptionStatus.mockResolvedValue(null);

      const result = await service.resolveProviderCycle('sub_1', 'POLAR');

      expect(result).toEqual({ action: 'UNKNOWN' });
    });

    it('returns UNKNOWN when the provider lookup throws', async () => {
      paymentService.getSubscriptionStatus.mockRejectedValue(
        new Error('provider not implemented'),
      );

      const result = await service.resolveProviderCycle('sub_1', 'STRIPE');

      expect(result).toEqual({ action: 'UNKNOWN' });
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
        user: { name: 'Ada' },
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

    it('should send a downgrade email to the customer', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        plan: CustomerPlan.STARTUP,
        email: 'customer@example.com',
        user: { name: 'Ada' },
      });

      await service.downgradeToFreePlan('customer-123', 'PAYMENT_FAILED');

      expect(emailService.sendPlanDowngradedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'customer@example.com',
          name: 'Ada',
          previousPlan: CustomerPlan.STARTUP,
          reason: 'PAYMENT_FAILED',
          resetDate: expect.any(Date),
        }),
      );
    });

    it('should not fail the downgrade if the email cannot be queued', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        plan: CustomerPlan.INDIE,
        email: 'customer@example.com',
        user: { name: 'Ada' },
      });
      emailService.sendPlanDowngradedEmail.mockRejectedValueOnce(
        new Error('queue down'),
      );

      await expect(
        service.downgradeToFreePlan('customer-123', 'SUBSCRIPTION_EXPIRED'),
      ).resolves.toMatchObject({
        billingCycleStartAt: expect.any(Date),
        usageResetAt: expect.any(Date),
      });

      expect(prisma.customer.update).toHaveBeenCalled();
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

  // ── consumeQuota ─────────────────────────────────────────────────────────────

  describe('consumeQuota', () => {
    const customer = {
      id: 'customer-123',
      usageCount: 5,
      billingCycleStartAt: new Date('2026-05-01T00:00:00Z'),
      usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };

    const mockEval = (value: number) => {
      const evalFn = jest.fn().mockResolvedValue(value);
      redis.getClient.mockReturnValue({ eval: evalFn });
      return evalFn;
    };

    it('keys the counter by customer id and billing cycle start', async () => {
      const evalFn = mockEval(6);

      await service.consumeQuota(customer, 100);

      const expectedKey = `usage:customer-123:${customer.billingCycleStartAt.getTime()}`;
      expect(evalFn).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expectedKey,
        '5', // baseline seeded from snapshot usageCount
        '100', // limit
        expect.any(String), // ttl
      );
    });

    it('allows and returns the new usage when under the limit', async () => {
      mockEval(6);

      const result = await service.consumeQuota(customer, 100);

      expect(result).toEqual({ allowed: true, usage: 6 });
    });

    it('rejects without incrementing when the script returns -1', async () => {
      mockEval(-1);

      const result = await service.consumeQuota(customer, 100);

      expect(result).toEqual({ allowed: false, usage: 5 });
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('flushes to the DB every Nth increment', async () => {
      mockEval(10);
      prisma.customer.update.mockResolvedValue({} as any);

      await service.consumeQuota(customer, 100);

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-123' },
        data: { usageCount: 10 },
      });
    });

    it('does not flush on a non-Nth increment', async () => {
      mockEval(7);

      await service.consumeQuota(customer, 100);

      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('fails open to a DB increment when Redis errors', async () => {
      redis.getClient.mockReturnValue({
        eval: jest.fn().mockRejectedValue(new Error('redis down')),
      });
      prisma.customer.update.mockResolvedValue({} as any);

      const result = await service.consumeQuota(customer, 100);

      expect(result).toEqual({ allowed: true, usage: 6 });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'customer-123' },
        data: { usageCount: { increment: 1 } },
      });
    });

    it('fails closed when Redis errors and the snapshot is already at the limit', async () => {
      redis.getClient.mockReturnValue({
        eval: jest.fn().mockRejectedValue(new Error('redis down')),
      });

      const result = await service.consumeQuota({ ...customer, usageCount: 100 }, 100);

      expect(result).toEqual({ allowed: false, usage: 100 });
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });
});
