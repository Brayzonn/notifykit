import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { EmailService } from '../../src/email/email.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * Type helper for mocked Prisma service
 * This creates a type where all Prisma methods are Jest mocks
 */
export type MockedPrismaService = {
  user: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
  customer: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
  refreshToken: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
  };
  job: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
  deliveryLog: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  $disconnect: jest.Mock;
};

/**
 * Create a properly typed mock PrismaService for testing
 */
export const createMockPrismaService = (): MockedPrismaService => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  customer: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  refreshToken: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  job: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  deliveryLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  $disconnect: jest.fn(),
});

/**
 * Type helper for mocked Redis service
 */
export type MockedRedisService = {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  exists: jest.Mock;
  getClient: jest.Mock;
};

/**
 * Create a properly typed mock RedisService for testing
 */
export const createMockRedisService = (): MockedRedisService => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  getClient: jest.fn(() => ({
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
  })),
});

/**
 * Type helper for mocked JWT service
 */
export type MockedJwtService = {
  sign: jest.Mock;
  verify: jest.Mock;
  signAsync: jest.Mock;
  verifyAsync: jest.Mock;
  decode: jest.Mock;
};

/**
 * Create a properly typed mock JwtService for testing
 */
export const createMockJwtService = (): MockedJwtService => ({
  sign: jest.fn((payload) => `mock.jwt.token.${payload.sub}`),
  verify: jest.fn(() => ({
    sub: 'user-123',
    email: 'test@example.com',
    role: 'USER',
  })),
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
  decode: jest.fn(),
});

/**
 * Type helper for mocked Config service
 */
export type MockedConfigService = {
  get: jest.Mock;
  getOrThrow: jest.Mock;
};

/**
 * Create a properly typed mock ConfigService for testing
 */
export const createMockConfigService = (): MockedConfigService => ({
  get: jest.fn((key: string, defaultValue?: any) => {
    const config: Record<string, any> = {
      JWT_SECRET: 'test-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      STRIPE_SECRET_KEY: 'sk_test_mock',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_mock',
      SENDGRID_FROM_EMAIL: 'noreply@notifyhub.com',
    };
    return config[key] || defaultValue;
  }),
  getOrThrow: jest.fn(),
});

/**
 * Type helper for mocked Email service
 */
export type MockedEmailService = {
  sendOtpEmail: jest.Mock;
  sendWelcomeEmail: jest.Mock;
  sendResetPasswordEmail: jest.Mock;
  sendPaymentFailedEmail: jest.Mock;
};

/**
 * Create a properly typed mock EmailService for testing
 */
export const createMockEmailService = (): MockedEmailService => ({
  sendOtpEmail: jest.fn(),
  sendWelcomeEmail: jest.fn(),
  sendResetPasswordEmail: jest.fn(),
  sendPaymentFailedEmail: jest.fn(),
});

/**
 * Extract OTP from Redis for testing
 */
export const extractOtpFromRedis = async (
  redis: any,
  email: string,
  type: 'otp' | 'reset-password' = 'otp',
): Promise<string | null> => {
  const key = type === 'otp' ? `otp:${email}` : `reset-password:${email}`;
  return await redis.get(key);
};

/**
 * Wait for async operations
 */
export const waitForAsync = (ms: number = 100) =>
  new Promise((resolve) => setTimeout(resolve, ms));
