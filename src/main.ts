import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '@/app.module';
import { createCorsConfig } from '@/config/cors.config';
import { setupHelmetAndCompression } from '@/config/helmet-compression.config';
import { validationPipeOptions } from '@/config/validation.config';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { setupRequestSizeLimit } from '@/config/request-size.config';
import cookieParser from 'cookie-parser';
import { setupSwagger } from '@/config/swagger.config';

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

  const cookieSecret = configService.get<string>('COOKIE_SECRET');
  if (!cookieSecret) {
    throw new Error('COOKIE_SECRET is not defined in environment variables');
  }
  if (cookieSecret.length < 32) {
    logger.warn('COOKIE_SECRET should be at least 32 characters long.');
  }
  app.use(cookieParser(cookieSecret));

  setupHelmetAndCompression(app);
  app.enableCors(createCorsConfig(configService));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  if (nodeEnv !== 'production') {
    setupSwagger(app, port, logger);
  }

  app.enableShutdownHooks();

  await app.listen(port);

  const appUrl = await app.getUrl();
  logger.log(`Application is running on: ${appUrl}`);

  if (nodeEnv !== 'production') {
    logger.log(`API documentation: ${appUrl}/api/docs`);
  }

  logger.log(`Health check: ${appUrl}/api/v1/health`);

  logger.log(
    `JWT expires in: ${configService.get('JWT_ACCESS_TOKEN_EXPIRES_IN', '15m')}`,
  );
  logger.log(
    `Refresh token expires in: ${configService.get('JWT_REFRESH_TOKEN_EXPIRES_IN', '7d')}`,
  );
}
bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application', error);
  process.exit(1);
});
