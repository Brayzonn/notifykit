import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';

export function setupRequestSizeLimit(
  app: INestApplication,
  configService: ConfigService,
): void {
  app.use(
    json({
      limit: configService.get<string>('MAX_JSON_SIZE', '10mb'),
    }),
  );

  app.use(
    urlencoded({
      limit: configService.get<string>('MAX_FORM_SIZE', '10mb'),
      extended: true,
    }),
  );
}
