import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerMiddleware } from './common/middleware/activity-logger.middleware';

import { AppController } from '@/app.controller';
import { HealthModule } from '@/health/health.module';
import { RedisModule } from '@/redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
import { QueueModule } from './queues/queue.module';
import { CustomersModule } from './customers/customers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RedisModule,
    PrismaModule,
    QueueModule,
    NotificationsModule,
    HealthModule,
    CustomersModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
