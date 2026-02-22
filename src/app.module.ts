import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerMiddleware } from './common/middleware/activity-logger.middleware';
import { AppController } from '@/app.controller';
import { HealthModule } from '@/health/health.module';
import { RedisModule } from '@/redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
import { QueueModule } from './queues/queue.module';
import { AuthModule } from './auth/auth.module';
import { EmailModule } from './email/email.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { UserModule } from './user/user.module';
import { PaymentModule } from './payment/payment.module';
import { BillingModule } from './billing/billing.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RedisModule,
    PrismaModule,
    AuthModule,
    EmailModule,
    UserModule,
    QueueModule,
    NotificationsModule,
    HealthModule,
    BillingModule,
    PaymentModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
