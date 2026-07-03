import { ConfigService } from '@nestjs/config';
import { createCorsConfig } from './cors.config';

const configWith = (env: Record<string, string>): ConfigService =>
  ({
    get: (key: string, defaultValue?: unknown) =>
      key in env ? env[key] : defaultValue,
  }) as unknown as ConfigService;

const originRegex = (env: Record<string, string>): RegExp => {
  const origin = createCorsConfig(configWith(env)).origin as Array<
    string | RegExp
  >;
  const regex = origin.find((o) => o instanceof RegExp);
  if (!(regex instanceof RegExp)) {
    throw new Error('expected an origin RegExp');
  }
  return regex;
};

describe('createCorsConfig (production ALLOWED_DOMAIN)', () => {
  it('throws when CORS_ORIGIN is missing in production', () => {
    expect(() =>
      createCorsConfig(configWith({ NODE_ENV: 'production' })),
    ).toThrow('CORS_ORIGIN must be set in production');
  });

  it('allows real subdomains of a multi-label ALLOWED_DOMAIN', () => {
    const regex = originRegex({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.example.com',
      ALLOWED_DOMAIN: 'foo.bar.com',
    });
    expect(regex.test('https://app.foo.bar.com')).toBe(true);
  });

  it('rejects origins that exploit an unescaped dot (foo.barXcom)', () => {
    const regex = originRegex({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.example.com',
      ALLOWED_DOMAIN: 'foo.bar.com',
    });
    // Every dot is escaped, so the `.` before `com` is a literal, not a wildcard.
    expect(regex.test('https://app.foo.barXcom')).toBe(false);
    expect(regex.test('https://foo.bar.com.evil.test')).toBe(false);
    expect(regex.test('http://app.foo.bar.com')).toBe(false);
  });

  it('preserves explicit CORS_ORIGIN entries alongside the wildcard regex', () => {
    const origin = createCorsConfig(
      configWith({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.example.com, https://dash.example.com',
        ALLOWED_DOMAIN: 'example.com',
      }),
    ).origin as Array<string | RegExp>;

    expect(origin).toContain('https://app.example.com');
    expect(origin).toContain('https://dash.example.com');
  });
});
