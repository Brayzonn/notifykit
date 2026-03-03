import { Module } from '@nestjs/common';
import { RedisModule } from '@/redis/redis.module';
import { UserRateLimitGuard } from '@/auth/guards/user-rate-limit.guard';
import { IpRateLimitGuard } from '@/auth/guards/ip-rate-limit.guard';

@Module({
  imports: [RedisModule],
  providers: [UserRateLimitGuard, IpRateLimitGuard],
  exports: [UserRateLimitGuard, IpRateLimitGuard],
})
export class RateLimitModule {}
