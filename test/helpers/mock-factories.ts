import {
  User,
  Customer,
  RefreshToken,
  UserRole,
  AuthProvider,
  CustomerPlan,
  PaymentProvider,
  SubscriptionStatus,
} from '@prisma/client';
import Stripe from 'stripe';

/**
 * Create a mock User object for testing
 */
export const createMockUser = (overrides?: Partial<User>): User => ({
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  password: '$argon2id$v=19$m=65536,t=3,p=4$hashedpassword',
  provider: AuthProvider.EMAIL,
  providerId: null,
  emailVerified: true,
  avatar: null,
  company: null,
  role: UserRole.USER,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
  ...overrides,
});

/**
 * Create a mock Customer object for testing
 */
/**
 * Extended Customer type with relations for testing
 */
export type CustomerWithRelations = Customer & {
  user?: {
    id: string;
    deletedAt: Date | null;
  };
};

export const createMockCustomer = (
  overrides?: Partial<CustomerWithRelations>,
): CustomerWithRelations => {
  const now = new Date();
  const resetDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  return {
    id: 'customer-123',
    userId: 'user-123',
    email: 'test@example.com',
    apiKey: 'nh_test_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
    apiKeyHash:
      'hash_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
    plan: CustomerPlan.FREE,
    monthlyLimit: 1000,
    usageCount: 0,
    usageResetAt: resetDate,
    billingCycleStartAt: now,
    isActive: true,
    subscriptionStatus: null,
    paymentProvider: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    nextBillingDate: null,
    lastPaymentDate: null,
    subscriptionEndDate: null,
    paymentMetadata: null,
    previousPlan: null,
    downgradedAt: null,
    sendingDomain: null,
    domainVerified: false,
    sendgridDomainId: null,
    domainDnsRecords: null,
    domainRequestedAt: null,
    domainVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

/**
 * Create a mock RefreshToken object for testing
 */
export const createMockRefreshToken = (
  userId: string = 'user-123',
  overrides?: Partial<RefreshToken>,
): RefreshToken => ({
  id: 'token-123',
  userId,
  token: 'mock.refresh.token',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  createdAt: new Date(),
  ...overrides,
});

/**
 * Create a mock Stripe subscription object for testing
 */
export const createMockStripeSubscription = (
  overrides?: Partial<Stripe.Subscription>,
): Stripe.Subscription => {
  const now = Math.floor(Date.now() / 1000);
  const oneMonthLater = now + 30 * 24 * 60 * 60;

  return {
    id: 'sub_123',
    object: 'subscription',
    customer: 'cus_123',
    status: 'active',
    current_period_start: now,
    current_period_end: oneMonthLater,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_123',
          object: 'subscription_item',
          current_period_end: oneMonthLater,
          current_period_start: now,
        } as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: '/v1/subscription_items',
    },
    metadata: {},
    created: now,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    ...overrides,
  } as Stripe.Subscription;
};

/**
 * Create a mock Stripe checkout session object for testing
 */
export const createMockStripeCheckoutSession = (
  overrides?: Partial<Stripe.Checkout.Session>,
): Stripe.Checkout.Session => ({
  id: 'cs_123',
  object: 'checkout.session',
  mode: 'subscription',
  customer: 'cus_123',
  subscription: 'sub_123',
  payment_status: 'paid',
  status: 'complete',
  metadata: {
    customerId: 'customer-123',
    plan: 'INDIE',
  },
  ...overrides,
} as Stripe.Checkout.Session);

/**
 * Create a mock Stripe invoice object for testing
 */
export const createMockStripeInvoice = (
  overrides?: Partial<Stripe.Invoice>,
): Stripe.Invoice => ({
  id: 'in_123',
  object: 'invoice',
  subscription: 'sub_123',
  customer: 'cus_123',
  amount_due: 2900,
  status: 'paid',
  parent: {
    subscription_details: {
      subscription: 'sub_123',
    },
  } as any,
  next_payment_attempt: null,
  ...overrides,
} as Stripe.Invoice);

/**
 * Create a mock Stripe webhook event object for testing
 */
export const createMockStripeEvent = (
  type: string,
  data: any,
): Stripe.Event => ({
  id: 'evt_123',
  object: 'event',
  type,
  data: {
    object: data,
  },
  api_version: '2023-10-16',
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  pending_webhooks: 0,
  request: {
    id: 'req_123',
    idempotency_key: 'key_123',
  },
} as Stripe.Event);

/**
 * Create a mock authenticated customer for guard testing
 */
export const createMockAuthenticatedCustomer = (
  overrides?: Partial<Customer>,
) => {
  const now = new Date();
  const resetDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    id: 'customer-123',
    email: 'test@example.com',
    plan: CustomerPlan.FREE,
    monthlyLimit: 1000,
    usageCount: 0,
    usageResetAt: resetDate,
    billingCycleStartAt: now,
    subscriptionStatus: null,
    paymentProvider: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    subscriptionEndDate: null,
    ...overrides,
  };
};
