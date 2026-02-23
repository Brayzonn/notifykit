import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PaystackWebhookHandler } from './paystack-webhook.handler';
import { BillingService } from '@/billing/billing.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { createMockCustomer } from '../../../test/helpers/mock-factories';
import {
  createMockPrismaService,
  createMockConfigService,
  createMockEmailService,
  type MockedPrismaService,
  type MockedConfigService,
  type MockedEmailService,
} from '../../../test/helpers/test-utils';
import { PaymentProvider, CustomerPlan, SubscriptionStatus } from '@prisma/client';

type MockedBillingService = {
  handleSubscriptionActivated: jest.Mock;
  handleSubscriptionCancelled: jest.Mock;
};

// ── Test helpers ──────────────────────────────────────────────────────────────

const PAYSTACK_SECRET = 'test-paystack-secret';

const buildPayload = (event: object): Buffer =>
  Buffer.from(JSON.stringify(event));

const computeSignature = (payload: Buffer): string =>
  crypto.createHmac('sha512', PAYSTACK_SECRET).update(payload).digest('hex');

/** Returns a signed { payload, signature } pair ready for handler.handle() */
const sign = (event: object) => {
  const payload = buildPayload(event);
  return { payload, signature: computeSignature(payload) };
};

const makeEvent = (type: string, data: object = {}) => ({ event: type, data });

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('PaystackWebhookHandler', () => {
  let handler: PaystackWebhookHandler;
  let billingService: MockedBillingService;
  let prisma: MockedPrismaService;
  let configService: MockedConfigService;
  let emailService: MockedEmailService;

  const mockBillingService: MockedBillingService = {
    handleSubscriptionActivated: jest.fn(),
    handleSubscriptionCancelled: jest.fn(),
  };

  const mockPrismaService = createMockPrismaService();
  const mockConfigService = createMockConfigService();
  const mockEmailService = createMockEmailService();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaystackWebhookHandler,
        { provide: BillingService, useValue: mockBillingService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    handler = module.get<PaystackWebhookHandler>(PaystackWebhookHandler);
    billingService = module.get(BillingService);
    prisma = module.get(PrismaService);
    configService = module.get(ConfigService);
    emailService = module.get(EmailService);

    configService.get.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        PAYSTACK_SECRET_KEY: PAYSTACK_SECRET,
        PAYSTACK_INDIE_PLAN_ID: 'PLN_indie_123',
        PAYSTACK_STARTUP_PLAN_ID: 'PLN_startup_456',
      };
      return config[key];
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ── Signature Verification ──────────────────────────────────────────────────

  describe('Signature Verification', () => {
    it('should throw when PAYSTACK_SECRET_KEY is not configured', async () => {
      configService.get.mockReturnValue(undefined);
      const { payload, signature } = sign(makeEvent('charge.success'));

      await expect(handler.handle(payload, signature)).rejects.toThrow(
        'PAYSTACK_SECRET_KEY not configured',
      );
    });

    it('should throw UnauthorizedException for an invalid signature', async () => {
      const { payload } = sign(makeEvent('charge.success'));

      await expect(handler.handle(payload, 'bad_signature')).rejects.toThrow(
        'Invalid webhook signature',
      );
    });

    it('should process the event when the signature is valid', async () => {
      const { payload, signature } = sign(makeEvent('unknown.event'));

      const result = await handler.handle(payload, signature);

      expect(result).toEqual({ received: true });
    });
  });

  // ── charge.success ──────────────────────────────────────────────────────────

  describe('charge.success', () => {
    const baseData = {
      customer: { email: 'customer@example.com', customer_code: 'CUS_abc123' },
      subscription: { subscription_code: 'SUB_abc123' },
      next_payment_date: '2026-03-23T00:00:00.000Z',
      metadata: { customerId: 'customer-123', plan: CustomerPlan.INDIE },
    };

    it('should activate the subscription', async () => {
      const { payload, signature } = sign(makeEvent('charge.success', baseData));

      await handler.handle(payload, signature);

      expect(billingService.handleSubscriptionActivated).toHaveBeenCalledWith(
        'customer-123',
        {
          providerSubscriptionId: 'SUB_abc123',
          providerCustomerId: 'CUS_abc123',
          plan: CustomerPlan.INDIE,
          paymentProvider: PaymentProvider.PAYSTACK,
          nextBillingDate: new Date('2026-03-23T00:00:00.000Z'),
        },
      );
    });

    it('should use next_payment_date from the event', async () => {
      const { payload, signature } = sign(
        makeEvent('charge.success', {
          ...baseData,
          next_payment_date: '2026-04-01T00:00:00.000Z',
        }),
      );

      await handler.handle(payload, signature);

      expect(billingService.handleSubscriptionActivated).toHaveBeenCalledWith(
        'customer-123',
        expect.objectContaining({
          nextBillingDate: new Date('2026-04-01T00:00:00.000Z'),
        }),
      );
    });

    it('should fall back to a 30-day default when next_payment_date is absent', async () => {
      const before = Date.now();
      const { payload, signature } = sign(
        makeEvent('charge.success', {
          customer: baseData.customer,
          subscription: baseData.subscription,
          metadata: baseData.metadata,
          // no next_payment_date
        }),
      );

      await handler.handle(payload, signature);

      const { nextBillingDate } = billingService.handleSubscriptionActivated.mock.calls[0][1];
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expect(nextBillingDate.getTime()).toBeGreaterThanOrEqual(before + thirtyDays - 1000);
      expect(nextBillingDate.getTime()).toBeLessThanOrEqual(Date.now() + thirtyDays + 1000);
    });

    it('should use top-level subscription_code as fallback when subscription object is absent', async () => {
      const { payload, signature } = sign(
        makeEvent('charge.success', {
          ...baseData,
          subscription: undefined,
          subscription_code: 'SUB_toplevel',
        }),
      );

      await handler.handle(payload, signature);

      expect(billingService.handleSubscriptionActivated).toHaveBeenCalledWith(
        'customer-123',
        expect.objectContaining({ providerSubscriptionId: 'SUB_toplevel' }),
      );
    });

    it('should warn and skip when metadata is missing', async () => {
      const { payload, signature } = sign(
        makeEvent('charge.success', {
          ...baseData,
          metadata: undefined,
        }),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith('Missing metadata in charge.success event');
      expect(billingService.handleSubscriptionActivated).not.toHaveBeenCalled();
    });

    it('should warn and skip when subscription code is missing', async () => {
      const { payload, signature } = sign(
        makeEvent('charge.success', {
          ...baseData,
          subscription: undefined,
          subscription_code: undefined,
        }),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith('No subscription code in charge.success event');
      expect(billingService.handleSubscriptionActivated).not.toHaveBeenCalled();
    });

    it('should warn and skip when customer code is missing', async () => {
      const { payload, signature } = sign(
        makeEvent('charge.success', {
          ...baseData,
          customer: undefined,
        }),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith('No customer code in charge.success event');
      expect(billingService.handleSubscriptionActivated).not.toHaveBeenCalled();
    });
  });

  // ── subscription.create ─────────────────────────────────────────────────────

  describe('subscription.create', () => {
    const mockCustomer = createMockCustomer({ providerCustomerId: 'CUS_abc123' });

    const baseData = {
      subscription_code: 'SUB_abc123',
      customer: { email: 'customer@example.com', customer_code: 'CUS_abc123' },
      plan: { plan_code: 'PLN_indie_123', name: 'Indie' },
      next_payment_date: '2026-03-23T00:00:00.000Z',
    };

    it('should find the customer by providerCustomerId and activate the subscription', async () => {
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);

      const { payload, signature } = sign(makeEvent('subscription.create', baseData));

      await handler.handle(payload, signature);

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: { providerCustomerId: 'CUS_abc123' },
      });
      expect(billingService.handleSubscriptionActivated).toHaveBeenCalledWith(
        mockCustomer.id,
        {
          providerSubscriptionId: 'SUB_abc123',
          providerCustomerId: 'CUS_abc123',
          plan: CustomerPlan.INDIE,
          paymentProvider: PaymentProvider.PAYSTACK,
          nextBillingDate: new Date('2026-03-23T00:00:00.000Z'),
        },
      );
    });

    it('should map the STARTUP plan code correctly', async () => {
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);

      const { payload, signature } = sign(
        makeEvent('subscription.create', {
          ...baseData,
          plan: { plan_code: 'PLN_startup_456', name: 'Startup' },
        }),
      );

      await handler.handle(payload, signature);

      expect(billingService.handleSubscriptionActivated).toHaveBeenCalledWith(
        mockCustomer.id,
        expect.objectContaining({ plan: CustomerPlan.STARTUP }),
      );
    });

    it('should warn and skip when required data is missing', async () => {
      const { payload, signature } = sign(
        makeEvent('subscription.create', {
          ...baseData,
          subscription_code: undefined,
        }),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Missing required data in subscription.create event',
      );
      expect(billingService.handleSubscriptionActivated).not.toHaveBeenCalled();
    });

    it('should warn and skip on an unknown plan code', async () => {
      const { payload, signature } = sign(
        makeEvent('subscription.create', {
          ...baseData,
          plan: { plan_code: 'PLN_unknown', name: 'Unknown' },
        }),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith('Unknown plan code: PLN_unknown');
      expect(billingService.handleSubscriptionActivated).not.toHaveBeenCalled();
    });

    it('should warn and skip when the customer is not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const { payload, signature } = sign(makeEvent('subscription.create', baseData));

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Customer not found for customer code CUS_abc123',
      );
      expect(billingService.handleSubscriptionActivated).not.toHaveBeenCalled();
    });
  });

  // ── subscription.disable ────────────────────────────────────────────────────

  describe('subscription.disable', () => {
    it('should cancel the subscription', async () => {
      const { payload, signature } = sign(
        makeEvent('subscription.disable', { subscription_code: 'SUB_abc123' }),
      );

      await handler.handle(payload, signature);

      expect(billingService.handleSubscriptionCancelled).toHaveBeenCalledWith('SUB_abc123');
    });

    it('should warn and skip when subscription code is missing', async () => {
      const { payload, signature } = sign(makeEvent('subscription.disable', {}));

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith(
        'No subscription code in subscription.disable event',
      );
      expect(billingService.handleSubscriptionCancelled).not.toHaveBeenCalled();
    });
  });

  // ── invoice.payment_failed ──────────────────────────────────────────────────

  describe('invoice.payment_failed', () => {
    const mockCustomer = createMockCustomer({
      providerSubscriptionId: 'SUB_abc123',
      email: 'customer@example.com',
      plan: CustomerPlan.INDIE,
    });

    const baseData = { subscription_code: 'SUB_abc123', amount: 4900 };

    beforeEach(() => {
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);
      prisma.customer.update.mockResolvedValue(mockCustomer);
      emailService.sendPaymentFailedEmail.mockResolvedValue(undefined);
    });

    it('should mark the subscription as PAST_DUE', async () => {
      const { payload, signature } = sign(makeEvent('invoice.payment_failed', baseData));

      await handler.handle(payload, signature);

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: mockCustomer.id },
        data: { subscriptionStatus: SubscriptionStatus.PAST_DUE },
      });
    });

    it('should send a payment failed email', async () => {
      const { payload, signature } = sign(makeEvent('invoice.payment_failed', baseData));

      await handler.handle(payload, signature);

      expect(emailService.sendPaymentFailedEmail).toHaveBeenCalledWith({
        email: 'customer@example.com',
        name: 'customer',
        plan: CustomerPlan.INDIE,
        amount: 49,
        retryDate: null,
      });
    });

    it('should divide amount by 100 (kobo → naira)', async () => {
      const { payload, signature } = sign(
        makeEvent('invoice.payment_failed', { ...baseData, amount: 10000 }),
      );

      await handler.handle(payload, signature);

      expect(emailService.sendPaymentFailedEmail).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100 }),
      );
    });

    it('should default amount to 0 when absent', async () => {
      const { payload, signature } = sign(
        makeEvent('invoice.payment_failed', { subscription_code: 'SUB_abc123' }),
      );

      await handler.handle(payload, signature);

      expect(emailService.sendPaymentFailedEmail).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 0 }),
      );
    });

    it('should warn and skip when subscription code is missing', async () => {
      const { payload, signature } = sign(makeEvent('invoice.payment_failed', {}));

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith(
        'No subscription code in invoice.payment_failed event',
      );
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('should warn and skip when the customer is not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const { payload, signature } = sign(makeEvent('invoice.payment_failed', baseData));

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Customer not found for subscription SUB_abc123',
      );
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('should handle email send errors gracefully and still return received: true', async () => {
      emailService.sendPaymentFailedEmail.mockRejectedValue(
        new Error('SMTP unavailable'),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'error');
      const { payload, signature } = sign(makeEvent('invoice.payment_failed', baseData));

      const result = await handler.handle(payload, signature);

      expect(result).toEqual({ received: true });
      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to send payment failed email: SMTP unavailable',
        expect.any(Error),
      );
    });
  });

  // ── Unknown events ──────────────────────────────────────────────────────────

  describe('Unknown event types', () => {
    it('should log unhandled event type', async () => {
      const { payload, signature } = sign(makeEvent('some.unknown.event'));

      const loggerSpy = jest.spyOn(handler['logger'], 'log');
      await handler.handle(payload, signature);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Unhandled Paystack event type: some.unknown.event',
      );
    });

    it('should return { received: true } for unknown events', async () => {
      const { payload, signature } = sign(makeEvent('some.unknown.event'));

      const result = await handler.handle(payload, signature);

      expect(result).toEqual({ received: true });
    });
  });

  // ── Error propagation ───────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should rethrow errors from event handlers and log them', async () => {
      billingService.handleSubscriptionCancelled.mockRejectedValue(
        new Error('Database error'),
      );

      const { payload, signature } = sign(
        makeEvent('subscription.disable', { subscription_code: 'SUB_abc123' }),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'error');

      await expect(handler.handle(payload, signature)).rejects.toThrow('Database error');
      expect(loggerSpy).toHaveBeenCalledWith(
        'Error processing webhook: Database error',
        expect.any(Error),
      );
    });
  });
});
