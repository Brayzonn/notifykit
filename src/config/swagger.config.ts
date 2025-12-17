import { INestApplication, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

export function createSwaggerConfig(port: number) {
  return new DocumentBuilder()
    .setTitle('NestJS-Starter-API')
    .setDescription('NestJS-Starter-API ')
    .setVersion('1.0.0')
    .setContact(
      'Developer Support',
      'https://github.com/brayzonn/NestJS-Starter ',
      'support@yourdomain.com',
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer(`http://localhost:${port}`, 'Development Server')
    .addServer('https://api.yourdomain.com', 'Production Server')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token for authentication',
        in: 'header',
      },
      'JWT-auth',
    )
    .addCookieAuth('refreshToken', {
      type: 'apiKey',
      in: 'cookie',
      description: 'Refresh token stored in httpOnly cookie',
    })
    .addOAuth2(
      {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://example.com/oauth/authorize',
            tokenUrl: 'https://example.com/oauth/token',
            scopes: {
              'read:data': 'Read access to data',
              'write:data': 'Write access to data',
            },
          },
        },
      },
      'OAuth2',
    )
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management')
    .build();
}

export function setupSwagger(
  app: INestApplication,
  port: number,
  logger: Logger,
): void {
  const config = createSwaggerConfig(port);
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
