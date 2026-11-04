import { ConfigService } from '@nestjs/config';
import { parseDurationMs } from '@/common/utils/duration.util';

export const DEFAULT_REFRESH_TOKEN_EXPIRES_IN = '7d';

export function getRefreshTokenTtlMs(configService: ConfigService): number {
  return parseDurationMs(
    configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      DEFAULT_REFRESH_TOKEN_EXPIRES_IN,
    ),
  );
}
