import { Module } from '@nestjs/common';
import { RedisModule } from '@/redis/redis.module';
import { IpRateLimitGuard } from '@/auth/guards/ip-rate-limit.guard';

@Module({
  imports: [RedisModule],
  providers: [IpRateLimitGuard],
  exports: [IpRateLimitGuard],
})
export class RateLimitModule {}
