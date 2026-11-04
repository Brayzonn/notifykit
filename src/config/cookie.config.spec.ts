import { ConfigService } from '@nestjs/config';
import { CookieConfig } from './cookie.config';

const configWith = (values: Record<string, string>) =>
  ({
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('CookieConfig.getRefreshTokenOptions', () => {
  it('sets maxAge from JWT_REFRESH_EXPIRES_IN', () => {
    const options = CookieConfig.getRefreshTokenOptions(
      configWith({ JWT_REFRESH_EXPIRES_IN: '12h' }),
    );

    expect(options.maxAge).toBe(12 * 60 * 60 * 1000);
  });

  it('defaults maxAge to 7 days', () => {
    const options = CookieConfig.getRefreshTokenOptions(configWith({}));

    expect(options.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
