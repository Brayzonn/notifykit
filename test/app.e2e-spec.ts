import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { closeBullQueues } from './helpers/test-utils';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await closeBullQueues(moduleFixture);
    await app.close();
  });

  it('GET /ping returns pong', () => {
    return request(app.getHttpServer())
      .get('/ping')
      .expect(200)
      .expect({ message: 'pong' });
  });
});
