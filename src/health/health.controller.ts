import {
  Controller,
  Get,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { IpRateLimitGuard } from '@/auth/guards/ip-rate-limit.guard';
import { IpRateLimit } from '@/auth/decorators/ip-rate-limit.decorator';
import { Public } from '@/auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('simple')
  @Public()
  @IpRateLimit(30)
  @UseGuards(IpRateLimitGuard)
  async simpleCheck() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.getClient().ping();
    } catch {
      throw new ServiceUnavailableException({ status: 'down' });
    }
    return { status: 'ok' };
  }
}
