import type { TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import type { EmailService } from '../../src/platform-email/email.service';
import { QUEUE_NAMES } from '../../src/queues/queue.constants';

// Without this, BullMQ's ioredis connections leak past test teardown and
// compete with the next run's Redis traffic, causing flaky timeouts.
export const closeBullQueues = async (
  moduleFixture: TestingModule,
): Promise<void> => {
  for (const name of Object.values(QUEUE_NAMES)) {
    try {
      const queue = moduleFixture.get<{ close: () => Promise<void> }>(
        getQueueToken(name),
        { strict: false },
      );
      if (queue && typeof queue.close === 'function') {
        await queue.close();
      }
    } catch {
      // queue not registered in this module
    }
  }
};

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
  customerEmailProvider: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
    aggregate: jest.Mock;
  };
  customerSendingDomain: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
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
    count: jest.Mock;
  };
  deliveryLog: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  platformEmailLog: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  $disconnect: jest.Mock;
  $transaction: jest.Mock;
};

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
  customerEmailProvider: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    aggregate: jest.fn(),
  },
  customerSendingDomain: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
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
    count: jest.fn(),
  },
  deliveryLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  platformEmailLog: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  $disconnect: jest.fn(),
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
});

export type MockedRedisService = {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  exists: jest.Mock;
  getClient: jest.Mock;
};

export const createMockRedisService = (): MockedRedisService => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  getClient: jest.fn(() => ({
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  })),
});

export type MockedJwtService = {
  sign: jest.Mock;
  verify: jest.Mock;
  signAsync: jest.Mock;
  verifyAsync: jest.Mock;
  decode: jest.Mock;
};

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

export type MockedConfigService = {
  get: jest.Mock;
  getOrThrow: jest.Mock;
};

export const createMockConfigService = (): MockedConfigService => ({
  get: jest.fn((key: string, defaultValue?: any) => {
    const config: Record<string, any> = {
      JWT_SECRET: 'test-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      STRIPE_SECRET_KEY: 'sk_test_mock',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_mock',
      SENDGRID_FROM_EMAIL: 'noreply@notifykit.dev',
    };
    return config[key] || defaultValue;
  }),
  getOrThrow: jest.fn(),
});

// Derived from EmailService so a new send* method triggers a TS error here
// until it's mocked.
export type MockedEmailService = {
  [K in keyof EmailService as EmailService[K] extends (...args: any[]) => any
    ? K
    : never]: jest.Mock;
};

export const createMockEmailService = (): MockedEmailService => {
  const resolved = () => jest.fn().mockResolvedValue(undefined);
  return {
    sendOtpEmail: resolved(),
    sendResetPasswordEmail: resolved(),
    sendWelcomeEmail: resolved(),
    sendPasswordResetEmail: resolved(),
    sendEmailChangeVerification: resolved(),
    sendEmailChangeConfirmation: resolved(),
    sendEmailChangeCancelled: resolved(),
    sendEmailChangeSuccess: resolved(),
    sendPaymentFailedEmail: resolved(),
    sendDomainProviderAddedEmail: resolved(),
  } satisfies MockedEmailService;
};

export const extractOtpFromRedis = async (
  redis: any,
  email: string,
  type: 'otp' | 'reset-password' = 'otp',
): Promise<string | null> => {
  const key = type === 'otp' ? `otp:${email}` : `reset-password:${email}`;
  return await redis.get(key);
};

export const waitForAsync = (ms: number = 100) =>
  new Promise((resolve) => setTimeout(resolve, ms));
