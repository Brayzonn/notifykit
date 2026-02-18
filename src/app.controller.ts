import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';

@Public()
@Controller('')
export class AppController {
  @Get('ping')
  ping() {
    return {
      message: 'ponggg',
    };
  }

  @Get('info')
  getApiInfo() {
    return {
      name: 'NotifyHub API',
      version: '1.0.0',
      description:
        'Notification infrastructure service for emails and webhooks',
      documentation: 'https://docs.notifyhub.com',
    };
  }
}
