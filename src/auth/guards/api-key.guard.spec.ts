import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '@/prisma/prisma.service';
import { createMockCustomer, type CustomerWithRelations } from '../../../test/helpers/mock-factories';
import { createMockPrismaService, type MockedPrismaService } from '../../../test/helpers/test-utils';
import * as crypto from 'crypto';

type RequestWithCustomer = {
  headers: Record<string, string>;
  customer?: CustomerWithRelations;
};

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prisma: MockedPrismaService;

  const mockPrismaService = createMockPrismaService();

  const createMockExecutionContext = (request: RequestWithCustomer): ExecutionContext => {
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
        getResponse: jest.fn(),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('API Key Extraction', () => {
    it('should extract API key from x-api-key header', async () => {
      const validApiKey = 'nh_' + 'a'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(prisma.customer.findUnique).toHaveBeenCalledWith({
        where: { apiKeyHash },
        select: expect.any(Object),
      });
    });

    it('should extract API key from Authorization Bearer header', async () => {
      const validApiKey = 'nh_' + 'b'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          authorization: `Bearer ${validApiKey}`,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should prioritize x-api-key over Authorization header', async () => {
      const apiKey1 = 'nh_' + 'c'.repeat(64);
      const apiKey2 = 'nh_' + 'd'.repeat(64);
      const apiKeyHash1 = crypto
        .createHash('sha256')
        .update(apiKey1)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash: apiKeyHash1,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          'x-api-key': apiKey1,
          authorization: `Bearer ${apiKey2}`,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      await guard.canActivate(context);

      expect(prisma.customer.findUnique).toHaveBeenCalledWith({
        where: { apiKeyHash: apiKeyHash1 },
        select: expect.any(Object),
      });
    });

    it('should throw UnauthorizedException if API key is missing', async () => {
      const request = {
        headers: {},
      };
      const context = createMockExecutionContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'API key is missing',
      );
    });
  });

  describe('API Key Format Validation', () => {
    it('should validate format: nh_[64 hex chars]', async () => {
      const validApiKey = 'nh_' + 'a1b2c3d4e5f6'.repeat(5) + 'abcd'; // 64 hex chars
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should throw UnauthorizedException for invalid format (wrong prefix)', async () => {
      const invalidApiKey = 'invalid_' + 'a'.repeat(64);

      const request = {
        headers: {
          'x-api-key': invalidApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid API key format',
      );
    });

    it('should throw UnauthorizedException for invalid format (wrong length)', async () => {
      const invalidApiKey = 'nh_' + 'a'.repeat(32); // Too short

      const request = {
        headers: {
          'x-api-key': invalidApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid API key format',
      );
    });

    it('should throw UnauthorizedException for invalid format (non-hex chars)', async () => {
      const invalidApiKey = 'nh_' + 'g'.repeat(64); // 'g' is not hex

      const request = {
        headers: {
          'x-api-key': invalidApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid API key format',
      );
    });

    it('should log invalid format attempts', async () => {
      const invalidApiKey = 'nh_invalid';
      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      const request = {
        headers: {
          'x-api-key': invalidApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid API key format'),
      );
    });
  });

  describe('API Key Hash Lookup', () => {
    it('should hash API key with SHA256', async () => {
      const validApiKey = 'nh_' + '1234567890abcdef'.repeat(4);
      const expectedHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash: expectedHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      await guard.canActivate(context);

      expect(prisma.customer.findUnique).toHaveBeenCalledWith({
        where: { apiKeyHash: expectedHash },
        select: expect.any(Object),
      });
    });

    it('should query Prisma by apiKeyHash', async () => {
      const validApiKey = 'nh_' + 'f'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      await guard.canActivate(context);

      expect(prisma.customer.findUnique).toHaveBeenCalledWith({
        where: { apiKeyHash },
        select: {
          id: true,
          email: true,
          plan: true,
          monthlyLimit: true,
          usageCount: true,
          usageResetAt: true,
          billingCycleStartAt: true,
          isActive: true,
          subscriptionStatus: true,
          paymentProvider: true,
          providerCustomerId: true,
          providerSubscriptionId: true,
          subscriptionEndDate: true,
          user: {
            select: {
              id: true,
              deletedAt: true,
            },
          },
        },
      });
    });

    it('should throw UnauthorizedException if API key not found', async () => {
      const validApiKey = 'nh_' + 'e'.repeat(64);

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid API key',
      );
    });
  });

  describe('Customer Validation', () => {
    it('should check if customer.isActive is true', async () => {
      const validApiKey = 'nh_' + 'a'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should check if customer.user.deletedAt is null', async () => {
      const validApiKey = 'nh_' + 'b'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should throw ForbiddenException if account deleted', async () => {
      const validApiKey = 'nh_' + 'c'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: new Date() } as any,
      });

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Account has been deleted',
      );
    });

    it('should throw ForbiddenException if account inactive', async () => {
      const validApiKey = 'nh_' + 'd'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: false,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Account is inactive',
      );
    });
  });

  describe('Request Enrichment', () => {
    it('should attach customer object to request', async () => {
      const validApiKey = 'nh_' + 'e'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        id: 'customer-456',
        email: 'customer@example.com',
        apiKeyHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request: RequestWithCustomer = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      await guard.canActivate(context);

      expect(request.customer).toBeDefined();
      expect(request.customer!.id).toBe('customer-456');
      expect(request.customer!.email).toBe('customer@example.com');
    });

    it('should include all required fields in customer object', async () => {
      const validApiKey = 'nh_' + 'f'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: true,
        plan: 'INDIE' as any,
        monthlyLimit: 10000,
        usageCount: 500,
        user: { id: 'user-123', deletedAt: null },
      });

      const request: RequestWithCustomer = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      await guard.canActivate(context);

      expect(request.customer!).toMatchObject({
        id: expect.any(String),
        email: expect.any(String),
        plan: expect.any(String),
        monthlyLimit: expect.any(Number),
        usageCount: expect.any(Number),
        usageResetAt: expect.any(Date),
        billingCycleStartAt: expect.any(Date),
      });
    });

    it('should return true on success', async () => {
      const validApiKey = 'nh_' + 'a'.repeat(64);
      const apiKeyHash = crypto
        .createHash('sha256')
        .update(validApiKey)
        .digest('hex');
      const mockCustomer = createMockCustomer({
        apiKeyHash,
        isActive: true,
        user: { id: 'user-123', deletedAt: null },
      });

      const request = {
        headers: {
          'x-api-key': validApiKey,
        },
      };
      const context = createMockExecutionContext(request);

      prisma.customer.findUnique.mockResolvedValue(mockCustomer);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});
