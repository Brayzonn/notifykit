import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '@/app.module';
import { createCorsConfig } from '@/config/cors.config';
import { validationPipeOptions } from '@/config/validation.config';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { setupRequestSizeLimit } from '@/config/request-size.config';
import { setupCookies } from '@/config/cookie.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn']
        : ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const port = configService.get<number>('PORT', 3000);

  logger.log(`Environment: ${nodeEnv}`);
  logger.log(`Starting application on port ${port}`);

  setupRequestSizeLimit(app, configService);
  setupCookies(app, configService);

  app.enableCors(createCorsConfig(configService));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Swagger setup
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('NotifyKit API')
      .setDescription('Notification infrastructure for modern products')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .addTag('Auth', 'Authentication endpoints')
      .addTag('User', 'User management endpoints')
      .addTag('Admin', 'Admin endpoints (requires ADMIN role)')
      .addTag('Billing', 'Billing and subscription management')
      .addTag('Notifications', 'Send email and webhook notifications')
      .addTag('Health', 'Health check endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });

    logger.log(`Swagger documentation will be available at: http://localhost:${port}/docs`);
  }

  app.enableShutdownHooks();

  await app.listen(port);

  const appUrl = await app.getUrl();
  logger.log(`Application is running on: ${appUrl}`);

  logger.log(`Health check: ${appUrl}/api/v1/health`);
}
bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application', error);
  process.exit(1);
});
