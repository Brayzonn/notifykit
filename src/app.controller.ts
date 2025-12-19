import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
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
