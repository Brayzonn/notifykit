import { validateEnv } from './env.validation';

const baseEnv = {
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_EXPIRES_IN: '15m',
  ENCRYPTION_KEY: 'c'.repeat(64),
  COOKIE_SECRET: 'd'.repeat(32),
  DATABASE_URL: 'postgresql://localhost/test',
};

describe('validateEnv JWT_REFRESH_EXPIRES_IN', () => {
  it('accepts a missing value', () => {
    expect(() => validateEnv(baseEnv)).not.toThrow();
  });

  it.each(['30s', '15m', '12h', '7d'])('accepts %s', (value) => {
    expect(() =>
      validateEnv({ ...baseEnv, JWT_REFRESH_EXPIRES_IN: value }),
    ).not.toThrow();
  });

  it.each(['7', '604800', '7days', '1.5h'])('rejects %s', (value) => {
    expect(() =>
      validateEnv({ ...baseEnv, JWT_REFRESH_EXPIRES_IN: value }),
    ).toThrow('JWT_REFRESH_EXPIRES_IN must be a whole number');
  });
});

describe('validateEnv JWT_EXPIRES_IN', () => {
  it('rejects a missing value', () => {
    const { JWT_EXPIRES_IN, ...env } = baseEnv;

    expect(() => validateEnv(env)).toThrow('JWT_EXPIRES_IN is required');
  });

  it.each(['30s', '15m', '3600s', '1h'])('accepts %s', (value) => {
    expect(() =>
      validateEnv({ ...baseEnv, JWT_EXPIRES_IN: value }),
    ).not.toThrow();
  });

  it.each(['15', '3600', '1w', '15 minutes'])('rejects %s', (value) => {
    expect(() => validateEnv({ ...baseEnv, JWT_EXPIRES_IN: value })).toThrow(
      'JWT_EXPIRES_IN must be a whole number',
    );
  });
});
