import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeWebhookHandler } from './stripe-webhook.handler';
import { BillingService } from '@/billing/billing.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import {
  createMockCustomer,
  createMockStripeSubscription,
  createMockStripeCheckoutSession,
  createMockStripeInvoice,
  createMockStripeEvent,
} from '../../../test/helpers/mock-factories';
import {
  createMockPrismaService,
  createMockConfigService,
  createMockEmailService,
  type MockedPrismaService,
  type MockedConfigService,
  type MockedEmailService,
} from '../../../test/helpers/test-utils';
import {
  PaymentProvider,
  CustomerPlan,
  SubscriptionStatus,
} from '@prisma/client';
import Stripe from 'stripe';

type MockedBillingService = {
  handleSubscriptionActivated: jest.Mock;
  handleSubscriptionCancelled: jest.Mock;
};

describe('StripeWebhookHandler', () => {
  let handler: StripeWebhookHandler;
  let billingService: MockedBillingService;
  let prisma: MockedPrismaService;
  let configService: MockedConfigService;
  let emailService: MockedEmailService;
  let mockStripe: any;

  const mockBillingService: MockedBillingService = {
    handleSubscriptionActivated: jest.fn(),
    handleSubscriptionCancelled: jest.fn(),
  };

  const mockPrismaService = createMockPrismaService();
  const mockConfigService = createMockConfigService();
  const mockEmailService = createMockEmailService();

  beforeEach(async () => {
    // Create mock Stripe instance
    mockStripe = {
      webhooks: {
        constructEvent: jest.fn(),
      },
      subscriptions: {
        retrieve: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookHandler,
        { provide: BillingService, useValue: mockBillingService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    handler = module.get<StripeWebhookHandler>(StripeWebhookHandler);
    billingService = module.get(BillingService);
    prisma = module.get(PrismaService);
    configService = module.get(ConfigService);
    emailService = module.get(EmailService);

    // Override Stripe instance with mock (readonly property)
    Object.defineProperty(handler, 'stripe', {
      value: mockStripe,
      writable: true,
    });

    // Restore configService implementation after module creation
    configService.get.mockImplementation((key: string) => {
      const config = {
        STRIPE_SECRET_KEY: 'sk_test_mock',
        STRIPE_WEBHOOK_SECRET: 'whsec_test_mock',
      };
      return config[key];
    });
  });

  afterEach(() => {
    jest.resetAllMocks(); // Reset call counts but keep implementations
  });

  describe('Signature Verification', () => {
    it('should throw error if STRIPE_WEBHOOK_SECRET not configured', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'STRIPE_WEBHOOK_SECRET') return undefined;
        return 'sk_test_mock';
      });

      const payload = Buffer.from('test');
      const signature = 'test_signature';

      await expect(handler.handle(payload, signature)).rejects.toThrow(
        'STRIPE_WEBHOOK_SECRET not configured',
      );
    });

    it('should throw error if Stripe not configured', async () => {
      Object.defineProperty(handler, 'stripe', {
        value: null,
        writable: true,
      });

      const payload = Buffer.from('test');
      const signature = 'test_signature';

      await expect(handler.handle(payload, signature)).rejects.toThrow(
        'Stripe not configured',
      );
    });

    it('should let Stripe SDK throw error for invalid signature', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      const payload = Buffer.from('test');
      const signature = 'invalid_signature';

      await expect(handler.handle(payload, signature)).rejects.toThrow(
        'Invalid signature',
      );
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        payload,
        signature,
        'whsec_test_mock',
      );
    });

    it('should successfully verify valid signature', async () => {
      const mockEvent = createMockStripeEvent('unknown.event', {});
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const payload = Buffer.from('test');
      const signature = 'valid_signature';

      const result = await handler.handle(payload, signature);

      expect(result).toEqual({ received: true });
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        payload,
        signature,
        'whsec_test_mock',
      );
    });
  });

  describe('checkout.session.completed', () => {
    it('should extract metadata and activate subscription', async () => {
      const session = createMockStripeCheckoutSession({
        metadata: {
          customerId: 'customer-123',
          plan: 'INDIE',
        },
        subscription: 'sub_123',
      });
      const subscription = createMockStripeSubscription({ id: 'sub_123' });
      const mockEvent = createMockStripeEvent(
        'checkout.session.completed',
        session,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockStripe.subscriptions.retrieve.mockResolvedValue(subscription);

      await handler.handle(Buffer.from('test'), 'signature');

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
        'sub_123',
        { expand: ['customer'] },
      );
      expect(billingService.handleSubscriptionActivated).toHaveBeenCalledWith(
        'customer-123',
        {
          providerSubscriptionId: 'sub_123',
          providerCustomerId: 'cus_123',
          plan: CustomerPlan.INDIE,
          paymentProvider: PaymentProvider.STRIPE,
          nextBillingDate: expect.any(Date),
        },
      );
    });

    it('should handle missing metadata gracefully', async () => {
      const session = createMockStripeCheckoutSession({
        metadata: {},
      });
      const mockEvent = createMockStripeEvent(
        'checkout.session.completed',
        session,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');

      await handler.handle(Buffer.from('test'), 'signature');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Missing metadata in checkout session',
      );
      expect(billingService.handleSubscriptionActivated).not.toHaveBeenCalled();
    });

    it('should handle missing subscription gracefully', async () => {
      const session = createMockStripeCheckoutSession({
        metadata: { customerId: 'customer-123', plan: 'INDIE' },
        subscription: null,
      });
      const mockEvent = createMockStripeEvent(
        'checkout.session.completed',
        session,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');

      await handler.handle(Buffer.from('test'), 'signature');

      expect(loggerSpy).toHaveBeenCalledWith(
        'No subscription in checkout session',
      );
      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('should extract subscription current_period_end correctly', async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const session = createMockStripeCheckoutSession({
        metadata: { customerId: 'customer-123', plan: 'STARTUP' },
        subscription: 'sub_123',
      });
      const subscription = createMockStripeSubscription({
        id: 'sub_123',
        items: {
          object: 'list',
          data: [
            {
              id: 'si_123',
              current_period_end: futureTimestamp,
            } as Stripe.SubscriptionItem,
          ],
          has_more: false,
          url: '/v1/subscription_items',
        },
      });
      const mockEvent = createMockStripeEvent(
        'checkout.session.completed',
        session,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockStripe.subscriptions.retrieve.mockResolvedValue(subscription);

      await handler.handle(Buffer.from('test'), 'signature');

      expect(billingService.handleSubscriptionActivated).toHaveBeenCalledWith(
        'customer-123',
        expect.objectContaining({
          nextBillingDate: new Date(futureTimestamp * 1000),
        }),
      );
    });
  });

  describe('customer.subscription.updated', () => {
    it('should update nextBillingDate from subscription item', async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const subscription = createMockStripeSubscription({
        id: 'sub_123',
        items: {
          object: 'list',
          data: [
            {
              id: 'si_123',
              current_period_end: futureTimestamp,
            } as Stripe.SubscriptionItem,
          ],
          has_more: false,
          url: '/v1/subscription_items',
        },
      });
      const mockCustomer = createMockCustomer({
        providerSubscriptionId: 'sub_123',
      });
      const mockEvent = createMockStripeEvent(
        'customer.subscription.updated',
        subscription,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);
      prisma.customer.update.mockResolvedValue(mockCustomer);

      await handler.handle(Buffer.from('test'), 'signature');

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: { providerSubscriptionId: 'sub_123' },
      });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: mockCustomer.id },
        data: {
          nextBillingDate: new Date(futureTimestamp * 1000),
        },
      });
    });

    it('should handle customer not found gracefully', async () => {
      const subscription = createMockStripeSubscription({ id: 'sub_unknown' });
      const mockEvent = createMockStripeEvent(
        'customer.subscription.updated',
        subscription,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      prisma.customer.findFirst.mockResolvedValue(null);

      const loggerSpy = jest.spyOn(handler['logger'], 'warn');

      await handler.handle(Buffer.from('test'), 'signature');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Customer not found for subscription sub_unknown',
      );
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('customer.subscription.deleted', () => {
    it('should call billingService.handleSubscriptionCancelled', async () => {
      const subscription = createMockStripeSubscription({ id: 'sub_123' });
      const mockEvent = createMockStripeEvent(
        'customer.subscription.deleted',
        subscription,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      await handler.handle(Buffer.from('test'), 'signature');

      expect(billingService.handleSubscriptionCancelled).toHaveBeenCalledWith(
        'sub_123',
      );
    });

    it('should log deletion', async () => {
      const subscription = createMockStripeSubscription({ id: 'sub_123' });
      const mockEvent = createMockStripeEvent(
        'customer.subscription.deleted',
        subscription,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const loggerSpy = jest.spyOn(handler['logger'], 'log');

      await handler.handle(Buffer.from('test'), 'signature');

      expect(loggerSpy).toHaveBeenCalledWith('Subscription deleted: sub_123');
    });
  });

  describe('invoice.payment_succeeded', () => {
    it('should update lastPaymentDate', async () => {
      const invoice = createMockStripeInvoice({
        parent: {
          subscription_details: {
            subscription: 'sub_123',
          },
        } as any,
      });
      const mockCustomer = createMockCustomer({
        providerSubscriptionId: 'sub_123',
      });
      const mockEvent = createMockStripeEvent(
        'invoice.payment_succeeded',
        invoice,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);
      prisma.customer.update.mockResolvedValue(mockCustomer);

      await handler.handle(Buffer.from('test'), 'signature');

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: { providerSubscriptionId: 'sub_123' },
      });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: mockCustomer.id },
        data: { lastPaymentDate: expect.any(Date) },
      });
    });

    it('should handle missing customer gracefully', async () => {
      const invoice = createMockStripeInvoice({
        parent: {
          subscription_details: {
            subscription: 'sub_unknown',
          },
        } as any,
      });
      const mockEvent = createMockStripeEvent(
        'invoice.payment_succeeded',
        invoice,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      prisma.customer.findFirst.mockResolvedValue(null);

      await handler.handle(Buffer.from('test'), 'signature');

      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('invoice.payment_failed', () => {
    it('should mark subscription as PAST_DUE', async () => {
      const invoice = createMockStripeInvoice({
        parent: {
          subscription_details: {
            subscription: 'sub_123',
          },
        } as any,
        amount_due: 2900,
        next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
      });
      const mockCustomer = createMockCustomer({
        providerSubscriptionId: 'sub_123',
        plan: CustomerPlan.INDIE,
      });
      const mockEvent = createMockStripeEvent(
        'invoice.payment_failed',
        invoice,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);
      prisma.customer.update.mockResolvedValue(mockCustomer);
      emailService.sendPaymentFailedEmail.mockResolvedValue(undefined);

      await handler.handle(Buffer.from('test'), 'signature');

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: mockCustomer.id },
        data: {
          subscriptionStatus: SubscriptionStatus.PAST_DUE,
        },
      });
    });

    it('should send payment failed email', async () => {
      const retryTimestamp = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
      const invoice = createMockStripeInvoice({
        parent: {
          subscription_details: {
            subscription: 'sub_123',
          },
        } as any,
        amount_due: 2900,
        next_payment_attempt: retryTimestamp,
      });
      const mockCustomer = createMockCustomer({
        email: 'customer@example.com',
        providerSubscriptionId: 'sub_123',
        plan: CustomerPlan.INDIE,
      });
      const mockEvent = createMockStripeEvent(
        'invoice.payment_failed',
        invoice,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);
      prisma.customer.update.mockResolvedValue(mockCustomer);
      emailService.sendPaymentFailedEmail.mockResolvedValue(undefined);

      await handler.handle(Buffer.from('test'), 'signature');

      expect(emailService.sendPaymentFailedEmail).toHaveBeenCalledWith({
        email: 'customer@example.com',
        name: 'customer',
        plan: CustomerPlan.INDIE,
        amount: 29,
        retryDate: new Date(retryTimestamp * 1000),
      });
    });

    it('should handle email send errors gracefully', async () => {
      const invoice = createMockStripeInvoice({
        parent: {
          subscription_details: {
            subscription: 'sub_123',
          },
        } as any,
        amount_due: 2900,
      });
      const mockCustomer = createMockCustomer({
        providerSubscriptionId: 'sub_123',
      });
      const mockEvent = createMockStripeEvent(
        'invoice.payment_failed',
        invoice,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);
      prisma.customer.update.mockResolvedValue(mockCustomer);
      emailService.sendPaymentFailedEmail.mockRejectedValue(
        new Error('Email send failed'),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'error');

      const result = await handler.handle(Buffer.from('test'), 'signature');

      expect(result).toEqual({ received: true });
      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to send payment failed email: Email send failed',
        expect.any(Error),
      );
    });

    it('should include retry date if available', async () => {
      const retryTimestamp = Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60;
      const invoice = createMockStripeInvoice({
        parent: {
          subscription_details: {
            subscription: 'sub_123',
          },
        } as any,
        amount_due: 4900,
        next_payment_attempt: retryTimestamp,
      });
      const mockCustomer = createMockCustomer({
        providerSubscriptionId: 'sub_123',
        plan: CustomerPlan.STARTUP,
      });
      const mockEvent = createMockStripeEvent(
        'invoice.payment_failed',
        invoice,
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);
      prisma.customer.update.mockResolvedValue(mockCustomer);
      emailService.sendPaymentFailedEmail.mockResolvedValue(undefined);

      await handler.handle(Buffer.from('test'), 'signature');

      expect(emailService.sendPaymentFailedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          retryDate: new Date(retryTimestamp * 1000),
        }),
      );
    });
  });

  describe('Unknown event types', () => {
    it('should log unhandled event type', async () => {
      const mockEvent = createMockStripeEvent('unknown.event.type', {});

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const loggerSpy = jest.spyOn(handler['logger'], 'log');

      await handler.handle(Buffer.from('test'), 'signature');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Unhandled event type: unknown.event.type',
      );
    });

    it('should return received: true for unknown events', async () => {
      const mockEvent = createMockStripeEvent('custom.event', {});

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

      const result = await handler.handle(Buffer.from('test'), 'signature');

      expect(result).toEqual({ received: true });
    });
  });

  describe('Error Handling', () => {
    it('should log error when subscription retrieval fails', async () => {
      // Ensure configService returns proper values
      configService.get.mockImplementation((key: string) => {
        const config = {
          STRIPE_SECRET_KEY: 'sk_test_mock',
          STRIPE_WEBHOOK_SECRET: 'whsec_test_mock',
        };
        return config[key];
      });

      const mockEvent = createMockStripeEvent(
        'checkout.session.completed',
        createMockStripeCheckoutSession(),
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      mockStripe.subscriptions.retrieve.mockRejectedValue(
        new Error('Stripe API error'),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'error');

      const result = await handler.handle(Buffer.from('test'), 'signature');

      // Should still return success even though subscription retrieval failed
      expect(result).toEqual({ received: true });
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to retrieve subscription'),
      );
    });

    it('should throw and log error when event handler throws', async () => {
      // Ensure configService returns proper values
      configService.get.mockImplementation((key: string) => {
        const config = {
          STRIPE_SECRET_KEY: 'sk_test_mock',
          STRIPE_WEBHOOK_SECRET: 'whsec_test_mock',
        };
        return config[key];
      });

      const mockEvent = createMockStripeEvent(
        'customer.subscription.deleted',
        createMockStripeSubscription(),
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      billingService.handleSubscriptionCancelled.mockRejectedValue(
        new Error('Database error'),
      );

      const loggerSpy = jest.spyOn(handler['logger'], 'error');

      await expect(
        handler.handle(Buffer.from('test'), 'signature'),
      ).rejects.toThrow('Database error');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Error processing webhook: Database error',
        expect.any(Error),
      );
    });
  });
});
