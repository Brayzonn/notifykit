import {
  User,
  Customer,
  CustomerEmailProvider,
  CustomerSendingDomain,
  RefreshToken,
  UserRole,
  AuthProvider,
  CustomerPlan,
  EmailProviderType,
} from '@prisma/client';

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
  emailProviders?: CustomerEmailProvider[];
  sendingDomains?: Pick<
    CustomerSendingDomain,
    'domain' | 'provider' | 'verified' | 'requestedAt' | 'verifiedAt'
  >[];
  _count?: { emailProviders: number };
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
    apiKey:
      'nh_test_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
    apiKeyHash:
      'hash_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
    apiKeyLastFour: 'abcd',
    emailProviders: [],
    sendingDomains: [],
    _count: { emailProviders: 0 },
    plan: CustomerPlan.FREE,
    monthlyLimit: 100,
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
    customMonthlyLimit: null,
    previousPlan: null,
    downgradedAt: null,
    webhookSigningSecret: null,
    webhookSigningSecretAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

export const makeSendingDomain = (
  domain: string,
  provider: EmailProviderType = EmailProviderType.SENDGRID,
  verified = true,
): Pick<
  CustomerSendingDomain,
  'domain' | 'provider' | 'verified' | 'requestedAt' | 'verifiedAt'
> => ({
  domain,
  provider,
  verified,
  requestedAt: new Date(),
  verifiedAt: verified ? new Date() : null,
});

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
  familyId: 'family-123',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  createdAt: new Date(),
  ...overrides,
});

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
    monthlyLimit: 100,
    customMonthlyLimit: null,
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
