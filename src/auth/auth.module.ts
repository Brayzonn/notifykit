import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './guards/api-key.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { QuotaGuard } from './guards/quota.guard';

@Module({
  providers: [ApiKeyGuard, RateLimitGuard, QuotaGuard],
  exports: [ApiKeyGuard, RateLimitGuard, QuotaGuard],
})
export class AuthModule {}
