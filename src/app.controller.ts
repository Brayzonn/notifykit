import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';
import { IpRateLimitGuard } from './auth/guards/ip-rate-limit.guard';
import { IpRateLimit } from './auth/decorators/ip-rate-limit.decorator';

@Public()
@IpRateLimit(60)
@UseGuards(IpRateLimitGuard)
@Controller('')
export class AppController {
  @Get('ping')
  ping() {
    return {
      message: 'pong',
    };
  }

  @Get('info')
  getApiInfo() {
    return {
      name: 'NotifyKit API',
      version: '1.0.0',
      description:
        'Notification infrastructure service for emails and webhooks',
      documentation: 'https://docs.notifykit.dev',
    };
  }
}
