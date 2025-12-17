import { CookieOptions } from 'express';
import { ConfigService } from '@nestjs/config';

export class CookieConfig {
  static getRefreshTokenOptions(configService: ConfigService): CookieOptions {
    const isProduction = configService.get('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }
}
