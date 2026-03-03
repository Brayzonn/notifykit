import { SetMetadata } from '@nestjs/common';

export const IP_RATE_LIMIT_KEY = 'ip_rate_limit';

export interface IpRateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export const IpRateLimit = (limit: number, windowSeconds = 60) =>
  SetMetadata(IP_RATE_LIMIT_KEY, { limit, windowSeconds });
