import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '@/auth/decorators/public.decorator';

@ApiTags('API Info')
@Controller()
export class AppController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Get API information' })
  getApiInfo() {
    return {
      name: 'My NestJS API',
      version: '1.0.0',
      description: 'A scalable REST API built with NestJS',
      documentation: '/api/docs',
      health: '/health',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    };
  }
}
