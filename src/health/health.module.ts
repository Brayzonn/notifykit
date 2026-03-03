import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from '@/health/health.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { RedisModule } from '@/redis/redis.module';
import { RateLimitModule } from '@/common/rate-limit/rate-limit.module';

@Module({
  imports: [TerminusModule, HttpModule, PrismaModule, RedisModule, RateLimitModule],
  controllers: [HealthController],
})
export class HealthModule {}
