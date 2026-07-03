import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCorsConfig } from '@/config/cors.config';
import { validationPipeOptions } from '@/config/validation.config';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { setupRequestSizeLimit } from '@/config/request-size.config';
import { setupCookies } from '@/config/cookie.config';

/**
 * Applies the global HTTP pipeline — proxy trust, body-size limits, cookies,
 * CORS, exception filter, response interceptor, validation, the `api` prefix,
 * and URI versioning. Both `bootstrap()` and the e2e tests call this so tests
 * exercise the exact pipeline that runs in production (same response envelope,
 * same validation, same routing) rather than a hand-rolled subset.
 */
export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);

  app.getHttpAdapter().getInstance().set('trust proxy', 1);
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
}
