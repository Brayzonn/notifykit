import { Module } from '@nestjs/common';
import { HealthController } from '@/health/health.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { RedisModule } from '@/redis/redis.module';
import { RateLimitModule } from '@/common/rate-limit/rate-limit.module';

@Module({
  imports: [PrismaModule, RedisModule, RateLimitModule],
  controllers: [HealthController],
})
export class HealthModule {}
