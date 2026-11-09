import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@/generated/prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { JwtPayload } from '@/auth/dto/auth.dto';
import {
  AuthTokens,
  RefreshTokenResponse,
} from '@/auth/interfaces/auth.interface';
import { RefreshTokenWithUser } from '@/auth/types/auth-service.types';
import {
  AuthRedisKeys,
  MAX_ACTIVE_SESSIONS,
  REFRESH_LOCK_TTL_SECONDS,
  REFRESH_ROTATION_WINDOW_MS,
} from '@/auth/constants/auth.constants';
import { getRefreshTokenTtlMs } from '@/config/jwt.config';
import { sanitizeUser } from '@/auth/helpers/auth.helpers';
import { hashToken } from '@/common/utils/hash.util';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly refreshSecret: string;
  private readonly refreshTtlMs: number;
  private readonly rotationWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.refreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.refreshTtlMs = getRefreshTokenTtlMs(this.configService);
    this.rotationWindowMs = Math.min(
      REFRESH_ROTATION_WINDOW_MS,
      this.refreshTtlMs / 2,
    );
  }

  async issueSession(user: User, familyId?: string): Promise<AuthTokens> {
    const tokens = this.generateTokens(user);
    await this.persistRefreshToken(user.id, tokens.refreshToken, familyId);
    return tokens;
  }

  async refresh(token: string): Promise<RefreshTokenResponse> {
    this.verifyRefreshToken(token);

    const lockKey = AuthRedisKeys.refreshLock(hashToken(token).slice(0, 16));
    const client = this.redis.getClient();
    const acquired = await client.set(
      lockKey,
      '1',
      'EX',
      REFRESH_LOCK_TTL_SECONDS,
      'NX',
    );

    if (!acquired) {
      throw new UnauthorizedException('Token refresh already in progress');
    }

    try {
      const storedToken = await this.validateStoredRefreshToken(token);
      const user = sanitizeUser(storedToken.user);

      if (this.isExpiringSoon(storedToken.expiresAt)) {
        return { user, tokens: await this.rotate(storedToken) };
      }

      const { accessToken } = this.generateTokens(storedToken.user);
      return { user, tokens: { accessToken } };
    } finally {
      await client.del(lockKey);
    }
  }

  async revoke(token: string): Promise<boolean> {
    try {
      await this.prisma.refreshToken.delete({
        where: { token: hashToken(token) },
      });
      return true;
    } catch {
      return false;
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.redis.del(AuthRedisKeys.userCache(userId));
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  private generateTokens(user: User): AuthTokens {
    const accessToken = this.jwtService.sign({ sub: user.id });

    const refreshToken = this.jwtService.sign(
      { sub: user.id, jti: crypto.randomUUID() },
      { secret: this.refreshSecret, expiresIn: this.refreshTtlMs / 1000 },
    );

    return { accessToken, refreshToken };
  }

  private verifyRefreshToken(token: string): JwtPayload {
    try {
      return this.jwtService.verify(token, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private async validateStoredRefreshToken(
    token: string,
  ): Promise<RefreshTokenWithUser> {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: hashToken(token) },
      include: { user: true },
    });

    if (!storedToken) {
      await this.handlePossibleReuse(token);
      throw new UnauthorizedException('Refresh token not found');
    }

    if (storedToken.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    if (storedToken.user.deletedAt) {
      await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException('Account has been deleted');
    }

    return storedToken;
  }

  private async handlePossibleReuse(token: string): Promise<void> {
    const payload = this.jwtService.decode(token);
    if (!payload?.sub) return;

    const activeTokens = await this.prisma.refreshToken.count({
      where: { userId: payload.sub },
    });

    if (activeTokens > 0) {
      this.logger.warn(
        `Possible refresh token reuse detected for user: ${payload.sub}`,
      );
      await this.prisma.refreshToken.deleteMany({
        where: { userId: payload.sub },
      });
      await this.redis.del(AuthRedisKeys.userCache(payload.sub));
    }
  }

  private isExpiringSoon(expiresAt: Date): boolean {
    return expiresAt < new Date(Date.now() + this.rotationWindowMs);
  }

  private async rotate(storedToken: RefreshTokenWithUser): Promise<AuthTokens> {
    const newTokens = this.generateTokens(storedToken.user);

    await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
    await this.persistRefreshToken(
      storedToken.user.id,
      newTokens.refreshToken,
      storedToken.familyId,
    );

    return newTokens;
  }

  private async persistRefreshToken(
    userId: string,
    refreshToken: string,
    familyId?: string,
  ): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });

    await this.enforceSessionLimit(userId);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: hashToken(refreshToken),
        familyId: familyId ?? crypto.randomUUID(),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });
  }

  private async enforceSessionLimit(userId: string): Promise<void> {
    const activeTokens = await this.prisma.refreshToken.count({
      where: { userId, expiresAt: { gt: new Date() } },
    });

    const tokensToDelete =
      activeTokens >= MAX_ACTIVE_SESSIONS
        ? activeTokens - MAX_ACTIVE_SESSIONS + 1
        : 0;

    if (tokensToDelete === 0) return;

    const oldestTokens = await this.prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: tokensToDelete,
      select: { id: true },
    });

    await this.prisma.refreshToken.deleteMany({
      where: { id: { in: oldestTokens.map((t) => t.id) } },
    });

    this.logger.log(
      `Deleted ${tokensToDelete} oldest refresh token(s) for user: ${userId}`,
    );
  }
}
