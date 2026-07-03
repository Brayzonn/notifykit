import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from '../src/config/configure-app';
import { closeBullQueues } from './helpers/test-utils';

// This suite guards the production HTTP pipeline itself: the global prefix, URI
// versioning, the ResponseInterceptor success envelope, and the
// AllExceptionsFilter error envelope. It boots the real AppModule and applies
// configureApp() — the same setup main.ts runs — so a regression in any of
// those global concerns is caught here rather than in production.
describe('HTTP pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await closeBullQueues(moduleFixture);
    await app.close();
  });

  it('serves routes under the /api/v1 prefix and wraps success responses', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ping')
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: { message: 'pong' },
      timestamp: expect.any(String),
    });
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it('does not serve routes without the version prefix', async () => {
    // Proves setGlobalPrefix + enableVersioning are actually applied.
    await request(app.getHttpServer()).get('/ping').expect(404);
  });

  it('wraps validation errors in the { success:false, error } envelope', async () => {
    // An empty signup body fails the global ValidationPipe before reaching the
    // controller, so this exercises ValidationPipe + AllExceptionsFilter only.
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.timestamp).toEqual(expect.any(String));
    expect(res.body.data).toBeUndefined();
  });
});
