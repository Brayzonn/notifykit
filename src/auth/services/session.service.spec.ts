import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionService } from './session.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { hashToken } from '@/common/utils/hash.util';
import {
  createMockUser,
  createMockRefreshToken,
} from '../../../test/helpers/mock-factories';
import {
  createMockPrismaService,
  createMockRedisService,
  createMockJwtService,
  createMockConfigService,
} from '../../../test/helpers/test-utils';

describe('SessionService', () => {
  let service: SessionService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedisService>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  const user = createMockUser();

  beforeEach(async () => {
    prisma = createMockPrismaService();
    redis = createMockRedisService();
    jwtService = createMockJwtService();

    const module = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = module.get(SessionService);
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe('issueSession', () => {
    it('persists the hashed refresh token with a new family id', async () => {
      prisma.refreshToken.count.mockResolvedValue(0);

      const tokens = await service.issueSession(user);

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: user.id,
          token: hashToken(tokens.refreshToken),
          familyId: expect.any(String),
        }),
      });
    });

    it('evicts the oldest sessions when the limit is reached', async () => {
      prisma.refreshToken.count.mockResolvedValue(6);
      prisma.refreshToken.findMany.mockResolvedValue([
        { id: 'old-1' },
        { id: 'old-2' },
      ]);

      await service.issueSession(user);

      expect(prisma.refreshToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2, orderBy: { createdAt: 'asc' } }),
      );
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-1', 'old-2'] } },
      });
    });

    it('does not evict when under the limit', async () => {
      prisma.refreshToken.count.mockResolvedValue(3);

      await service.issueSession(user);

      expect(prisma.refreshToken.findMany).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rejects when a refresh is already in progress', async () => {
      redis.getClient.mockReturnValue({
        set: jest.fn().mockResolvedValue(null),
        del: jest.fn(),
      });

      await expect(service.refresh('token')).rejects.toThrow(
        'Token refresh already in progress',
      );
    });

    it('revokes all sessions on suspected token reuse', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      jwtService.decode.mockReturnValue({ sub: user.id });
      prisma.refreshToken.count.mockResolvedValue(2);

      await expect(service.refresh('token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id },
      });
      expect(redis.del).toHaveBeenCalledWith(`user:${user.id}`);
    });

    it('keeps the token family when rotating', async () => {
      const stored = {
        ...createMockRefreshToken(user.id),
        familyId: 'family-1',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        user,
      };
      prisma.refreshToken.findUnique.mockResolvedValue(stored);
      prisma.refreshToken.count.mockResolvedValue(0);

      await service.refresh('token');

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ familyId: 'family-1' }),
      });
    });

    it('releases the lock even when validation fails', async () => {
      const client = {
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn(),
      };
      redis.getClient.mockReturnValue(client);
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('token')).rejects.toThrow();

      expect(client.del).toHaveBeenCalledWith(
        `refresh_lock:${hashToken('token').slice(0, 16)}`,
      );
    });
  });

  describe('refresh token lifetime', () => {
    const buildWithExpiry = async (expiresIn: string) => {
      const config = createMockConfigService();
      config.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'JWT_REFRESH_EXPIRES_IN'
          ? expiresIn
          : createMockConfigService().get(key, fallback),
      );
      const module = await Test.createTestingModule({
        providers: [
          SessionService,
          { provide: PrismaService, useValue: prisma },
          { provide: RedisService, useValue: redis },
          { provide: JwtService, useValue: jwtService },
          { provide: ConfigService, useValue: config },
        ],
      }).compile();
      return module.get(SessionService);
    };

    it('uses JWT_REFRESH_EXPIRES_IN for both the JWT and the database expiry', async () => {
      const twoHoursMs = 2 * 60 * 60 * 1000;
      const custom = await buildWithExpiry('2h');
      prisma.refreshToken.count.mockResolvedValue(0);

      const before = Date.now();
      await custom.issueSession(user);
      const after = Date.now();

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ jti: expect.any(String) }),
        expect.objectContaining({ expiresIn: twoHoursMs / 1000 }),
      );
      const { expiresAt } = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + twoHoursMs);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + twoHoursMs);
    });

    const refreshWithRemaining = async (
      svc: SessionService,
      remainingMs: number,
    ) => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...createMockRefreshToken(user.id),
        expiresAt: new Date(Date.now() + remainingMs),
        user,
      });
      prisma.refreshToken.count.mockResolvedValue(0);
      return svc.refresh('token');
    };

    it('does not rotate on every refresh when the lifetime is 3 days or less', async () => {
      const custom = await buildWithExpiry('2h');

      const result = await refreshWithRemaining(custom, 90 * 60 * 1000);

      expect(result.tokens.refreshToken).toBeUndefined();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rotates in the second half of a short lifetime', async () => {
      const custom = await buildWithExpiry('2h');

      const result = await refreshWithRemaining(custom, 30 * 60 * 1000);

      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('keeps the 3-day window for longer lifetimes', async () => {
      const custom = await buildWithExpiry('30d');
      const dayMs = 24 * 60 * 60 * 1000;

      const early = await refreshWithRemaining(custom, 4 * dayMs);
      expect(early.tokens.refreshToken).toBeUndefined();

      const late = await refreshWithRemaining(custom, 2 * dayMs);
      expect(late.tokens.refreshToken).toBeDefined();
    });

    it('fails to start with an unreadable value', async () => {
      await expect(buildWithExpiry('7')).rejects.toThrow('Invalid duration');
    });
  });

  describe('revokeAllForUser', () => {
    it('clears the user cache and deletes all refresh tokens', async () => {
      await service.revokeAllForUser(user.id);

      expect(redis.del).toHaveBeenCalledWith(`user:${user.id}`);
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id },
      });
    });
  });
});
