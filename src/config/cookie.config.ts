import { INestApplication } from '@nestjs/common';
import { CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { getRefreshTokenTtlMs } from '@/config/jwt.config';

export function setupCookies(
  app: INestApplication,
  configService: ConfigService,
): void {
  const cookieSecret = configService.getOrThrow<string>('COOKIE_SECRET');
  app.use(cookieParser(cookieSecret));
}

export class CookieConfig {
  static getRefreshTokenOptions(configService: ConfigService): CookieOptions {
    const isProduction = configService.get('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      maxAge: getRefreshTokenTtlMs(configService),
    };
  }
}
