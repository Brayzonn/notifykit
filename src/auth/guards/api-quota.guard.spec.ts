import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { QuotaGuard } from './api-quota.guard';
import { BillingService } from '@/billing/billing.service';
import { createMockAuthenticatedCustomer } from '../../../test/helpers/mock-factories';
import { CustomerPlan, SubscriptionStatus } from '@prisma/client';

type MockedBillingService = {
  consumeQuota: jest.Mock;
  incrementUsage: jest.Mock;
  resetMonthlyUsage: jest.Mock;
  downgradeToFreePlan: jest.Mock;
  resolveProviderCycle: jest.Mock;
  handleRenewalCharge: jest.Mock;
};

const newCycleDates = () => {
  const now = new Date();
  const usageResetAt = new Date(now);
  usageResetAt.setDate(usageResetAt.getDate() + 30);
  return { billingCycleStartAt: now, usageResetAt };
};

describe('QuotaGuard', () => {
  let guard: QuotaGuard;
  let authService: MockedBillingService;

  const mockAuthService: MockedBillingService = {
    // Emulates the real Redis-backed atomic check-and-increment.
    consumeQuota: jest.fn((c: { usageCount?: number }, limit: number) => {
      const usage = c.usageCount ?? 0;
      return Promise.resolve(
        usage >= limit
          ? { allowed: false, usage }
          : { allowed: true, usage: usage + 1 },
      );
    }),
    incrementUsage: jest.fn(),
    resetMonthlyUsage: jest.fn(() => Promise.resolve(newCycleDates())),
    downgradeToFreePlan: jest.fn(() => Promise.resolve(newCycleDates())),
    resolveProviderCycle: jest.fn(() => Promise.resolve({ action: 'UNKNOWN' })),
    handleRenewalCharge: jest.fn(() => Promise.resolve(newCycleDates())),
  };

  const createMockExecutionContext = (request: any): ExecutionContext => {
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest
          .fn()
          .mockReturnValue({ url: '/notification', ...request }),
        getResponse: jest.fn(),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotaGuard,
        { provide: BillingService, useValue: mockAuthService },
      ],
    }).compile();

    guard = module.get<QuotaGuard>(QuotaGuard);
    authService = module.get(BillingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Customer Authentication Check', () => {
    it('should throw HttpException if customer not on request', async () => {
      const request = {};
      const context = createMockExecutionContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Customer not authenticated',
      );
    });

    it('should use status 500 (INTERNAL_SERVER_ERROR)', async () => {
      const request = {};
      const context = createMockExecutionContext(request);

      try {
        await guard.canActivate(context);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  });

  describe('Billing Cycle Reset', () => {
    it('should reset usage for FREE plan when usageResetAt < now', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      const customer = createMockAuthenticatedCustomer({
        plan: CustomerPlan.FREE,
        usageResetAt: pastDate,
        usageCount: 500,
        monthlyLimit: 1000,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      await guard.canActivate(context);

      expect(authService.resetMonthlyUsage).toHaveBeenCalledWith(
        customer.id,
        undefined,
      );
      // After reset (0) + increment (1) = 1
      expect(customer.usageCount).toBe(1);
    });

    it('should reset usage for active subscriptions', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const customer = createMockAuthenticatedCustomer({
        plan: CustomerPlan.INDIE,
        usageResetAt: pastDate,
        usageCount: 5000,
        monthlyLimit: 10000,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndDate: futureDate,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      await guard.canActivate(context);

      expect(authService.resetMonthlyUsage).toHaveBeenCalledWith(
        customer.id,
        undefined,
      );
      // After reset (0) + increment (1) = 1
      expect(customer.usageCount).toBe(1);
    });

    it('should update usageResetAt to 30 days from now', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const customer = createMockAuthenticatedCustomer({
        plan: CustomerPlan.FREE,
        usageResetAt: pastDate,
        usageCount: 500,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const beforeResetDate = customer.usageResetAt;

      await guard.canActivate(context);

      expect(customer.usageResetAt.getTime()).toBeGreaterThan(
        beforeResetDate.getTime(),
      );
      expect(customer.usageResetAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should log FREE plan reset', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const customer = createMockAuthenticatedCustomer({
        plan: CustomerPlan.FREE,
        email: 'free@example.com',
        usageResetAt: pastDate,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const loggerSpy = jest.spyOn(guard['logger'], 'log');

      await guard.canActivate(context);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Reset FREE plan customer: free@example.com',
      );
    });
  });

  describe('Subscription Expiry Handling', () => {
    it('should handle 7-day grace period after subscription expiry', async () => {
      const pastResetDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
      const customer = createMockAuthenticatedCustomer({
        plan: CustomerPlan.INDIE,
        usageResetAt: pastResetDate,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndDate: expiredDate,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      await guard.canActivate(context);

      expect(authService.resetMonthlyUsage).toHaveBeenCalled();
      expect(authService.downgradeToFreePlan).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('in grace period'),
      );
    });

    it('should downgrade to FREE after grace period expires', async () => {
      const pastResetDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago (beyond 7-day grace)
      const customer = createMockAuthenticatedCustomer({
        id: 'customer-789',
        plan: CustomerPlan.INDIE,
        usageResetAt: pastResetDate,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndDate: expiredDate,
        monthlyLimit: 10000,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      await guard.canActivate(context);

      expect(authService.downgradeToFreePlan).toHaveBeenCalledWith(
        'customer-789',
        'SUBSCRIPTION_EXPIRED',
        undefined,
      );
      expect(customer.plan).toBe(CustomerPlan.FREE);
      expect(customer.monthlyLimit).toBe(100);
    });

    it('should sync customer plan to FREE in-memory after downgrade', async () => {
      const pastResetDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const customer = createMockAuthenticatedCustomer({
        plan: CustomerPlan.STARTUP,
        usageResetAt: pastResetDate,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndDate: expiredDate,
        monthlyLimit: 50000,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      await guard.canActivate(context);

      expect(customer.plan).toBe(CustomerPlan.FREE);
      expect(customer.monthlyLimit).toBe(100);
      // After reset (0) + increment (1) = 1
      expect(customer.usageCount).toBe(1);
    });

    it('should log grace period warnings with days left', async () => {
      const pastResetDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      const customer = createMockAuthenticatedCustomer({
        email: 'grace@example.com',
        plan: CustomerPlan.INDIE,
        usageResetAt: pastResetDate,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndDate: expiredDate,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      await guard.canActivate(context);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('grace@example.com'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('grace period'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('days left'),
      );
    });

    it('should log downgrade after grace period', async () => {
      const pastResetDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const customer = createMockAuthenticatedCustomer({
        email: 'expired@example.com',
        plan: CustomerPlan.INDIE,
        usageResetAt: pastResetDate,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndDate: expiredDate,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      await guard.canActivate(context);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('expired@example.com'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('downgraded to FREE'),
      );
    });
  });

  describe('Provider-Authoritative Reconciliation', () => {
    const paidStaleCustomer = (overrides?: any) =>
      createMockAuthenticatedCustomer({
        plan: CustomerPlan.INDIE,
        usageResetAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        usageCount: 5000,
        monthlyLimit: 10000,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        // Stale local end date — looks expired locally, but the provider is the
        // source of truth.
        subscriptionEndDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        paymentProvider: 'POLAR',
        providerSubscriptionId: 'sub_123',
        apiKeyHash: 'hash_abc',
        ...overrides,
      });

    it('renews via provider when subscription is still active (no wrongful downgrade)', async () => {
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      authService.resolveProviderCycle.mockResolvedValueOnce({
        action: 'RENEWED',
        periodEnd,
      });
      const customer = paidStaleCustomer();
      const context = createMockExecutionContext({ customer });

      const result = await guard.canActivate(context);

      expect(authService.resolveProviderCycle).toHaveBeenCalledWith(
        'sub_123',
        'POLAR',
      );
      expect(authService.handleRenewalCharge).toHaveBeenCalledWith(
        customer.id,
        periodEnd,
        'hash_abc',
      );
      expect(authService.downgradeToFreePlan).not.toHaveBeenCalled();
      expect(customer.plan).toBe(CustomerPlan.INDIE);
      expect(result).toBe(true);
    });

    it('downgrades when the provider reports the subscription lapsed', async () => {
      authService.resolveProviderCycle.mockResolvedValueOnce({
        action: 'LAPSED',
      });
      const customer = paidStaleCustomer();
      const context = createMockExecutionContext({ customer });

      await guard.canActivate(context);

      expect(authService.downgradeToFreePlan).toHaveBeenCalledWith(
        customer.id,
        'SUBSCRIPTION_EXPIRED',
        'hash_abc',
      );
      expect(customer.plan).toBe(CustomerPlan.FREE);
      expect(customer.monthlyLimit).toBe(100);
    });

    it('keeps the customer active without downgrading when provider is active but has no period end (ACTIVE)', async () => {
      authService.resolveProviderCycle.mockResolvedValueOnce({
        action: 'ACTIVE',
      });
      // Local end date is well past grace — legacy logic would have downgraded,
      // but a provider-confirmed-active customer must not be.
      const customer = paidStaleCustomer({
        subscriptionEndDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });
      const context = createMockExecutionContext({ customer });

      await guard.canActivate(context);

      expect(authService.resetMonthlyUsage).toHaveBeenCalledWith(
        customer.id,
        'hash_abc',
      );
      expect(authService.downgradeToFreePlan).not.toHaveBeenCalled();
      expect(authService.handleRenewalCharge).not.toHaveBeenCalled();
      expect(customer.plan).toBe(CustomerPlan.INDIE);
    });

    it('falls back to legacy grace handling when the provider is unreachable (UNKNOWN)', async () => {
      authService.resolveProviderCycle.mockResolvedValueOnce({
        action: 'UNKNOWN',
      });
      // subscriptionEndDate within grace so the legacy path resets rather than downgrades.
      const customer = paidStaleCustomer({
        subscriptionEndDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
      const context = createMockExecutionContext({ customer });

      await guard.canActivate(context);

      expect(authService.handleRenewalCharge).not.toHaveBeenCalled();
      expect(authService.resetMonthlyUsage).toHaveBeenCalledWith(
        customer.id,
        'hash_abc',
      );
      expect(authService.downgradeToFreePlan).not.toHaveBeenCalled();
    });

    it('does not consult the provider for FREE plan customers', async () => {
      const customer = createMockAuthenticatedCustomer({
        plan: CustomerPlan.FREE,
        usageResetAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        paymentProvider: 'POLAR',
        providerSubscriptionId: 'sub_123',
      });
      const context = createMockExecutionContext({ customer });

      await guard.canActivate(context);

      expect(authService.resolveProviderCycle).not.toHaveBeenCalled();
      expect(authService.resetMonthlyUsage).toHaveBeenCalled();
    });
  });

  describe('Usage Limit Enforcement', () => {
    it('should check usageCount >= monthlyLimit', async () => {
      const customer = createMockAuthenticatedCustomer({
        usageCount: 1000,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException if limit exceeded', async () => {
      const customer = createMockAuthenticatedCustomer({
        usageCount: 1001,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should include current usage and reset date in error message', async () => {
      const resetDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      const customer = createMockAuthenticatedCustomer({
        email: 'limit@example.com',
        usageCount: 1500,
        monthlyLimit: 1000,
        usageResetAt: resetDate,
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      try {
        await guard.canActivate(context);
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).message).toContain('1500');
        expect((error as ForbiddenException).message).toContain('1000');
        expect((error as ForbiddenException).message).toContain(
          'Monthly usage limit exceeded',
        );
      }
    });

    it('should log warning when limit exceeded', async () => {
      const customer = createMockAuthenticatedCustomer({
        email: 'warn@example.com',
        usageCount: 2000,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      await expect(guard.canActivate(context)).rejects.toThrow();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage limit exceeded'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('warn@example.com'),
      );
    });
  });

  describe('Usage Increment', () => {
    it('should consume quota on success', async () => {
      const customer = createMockAuthenticatedCustomer({
        id: 'customer-123',
        usageCount: 500,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      await guard.canActivate(context);

      expect(authService.consumeQuota).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'customer-123' }),
        1000,
      );
    });

    it('should update customer.usageCount in-memory', async () => {
      const customer = createMockAuthenticatedCustomer({
        usageCount: 750,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      await guard.canActivate(context);

      expect(customer.usageCount).toBe(751);
    });

    it('should log usage (debug level)', async () => {
      const customer = createMockAuthenticatedCustomer({
        email: 'debug@example.com',
        usageCount: 100,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const loggerSpy = jest.spyOn(guard['logger'], 'debug');

      await guard.canActivate(context);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('debug@example.com'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('should return true on success', async () => {
      const customer = createMockAuthenticatedCustomer({
        usageCount: 250,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle usageCount = 0', async () => {
      const customer = createMockAuthenticatedCustomer({
        usageCount: 0,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(customer.usageCount).toBe(1);
    });

    it('should handle usageCount = undefined (fallback to 0)', async () => {
      const customer = createMockAuthenticatedCustomer({
        usageCount: undefined,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(customer.usageCount).toBe(1);
    });

    it('should handle exactly at limit (usageCount === monthlyLimit)', async () => {
      const customer = createMockAuthenticatedCustomer({
        usageCount: 1000,
        monthlyLimit: 1000,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const request = { customer };
      const context = createMockExecutionContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
