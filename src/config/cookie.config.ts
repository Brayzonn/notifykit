import { INestApplication } from '@nestjs/common';
import { CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

export function setupCookies(
  app: INestApplication,
  configService: ConfigService,
): void {
  const cookieSecret = configService.get<string>(
    'COOKIE_SECRET',
    'dev-cookie-secret-change-in-production',
  );
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
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }

  static getAccessTokenOptions(configService: ConfigService): CookieOptions {
    const isProduction = configService.get('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000, // 15 minutes
    };
  }
}
