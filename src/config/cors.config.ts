import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';

// Escape every regex metacharacter, not just the first dot, so multi-label
// ALLOWED_DOMAIN values (e.g. "foo.bar.com") build an exact-match pattern
// instead of leaving later dots as "any character" wildcards.
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const createCorsConfig = (configService: ConfigService): CorsOptions => {
  const isProduction = configService.get('NODE_ENV') === 'production';

  if (isProduction) {
    const corsOrigin = configService.get('CORS_ORIGIN', '');
    if (!corsOrigin) {
      throw new Error('CORS_ORIGIN must be set in production');
    }
  }

  if (!isProduction) {
    return {
      origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://localhost:8080',
        ...configService.get('CORS_ORIGIN', '').split(',').filter(Boolean),
      ],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    };
  }

  const allowedOrigins = configService
    .get('CORS_ORIGIN', '')
    .split(',')
    .filter(Boolean)
    .map((origin: string) => origin.trim());

  const domain = configService.get<string>('ALLOWED_DOMAIN')?.trim();

  return {
    origin: [
      ...allowedOrigins,
      ...(domain
        ? [new RegExp(`^https:\\/\\/.*\\.${escapeRegExp(domain)}$`)]
        : []),
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  };
};
