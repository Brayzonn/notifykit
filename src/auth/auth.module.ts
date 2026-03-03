import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CustomerRateLimitGuard } from './guards/customer-rate-limit.guard';
import { QuotaGuard } from './guards/api-quota.guard';
import { RedisModule } from '@/redis/redis.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { EmailModule } from '@/email/email.module';
import { AuthController } from './auth.controller';
import { GithubStrategy } from './strategies/github.strategy';
import { BillingModule } from '@/billing/billing.module';
import { RateLimitModule } from '@/common/rate-limit/rate-limit.module';

@Module({
  imports: [
    RedisModule,
    EmailModule,
    BillingModule,
    RateLimitModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    ApiKeyGuard,
    CustomerRateLimitGuard,
    QuotaGuard,
    AuthService,
    JwtStrategy,
    GithubStrategy,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    ApiKeyGuard,
    CustomerRateLimitGuard,
    QuotaGuard,
  ],
})
export class AuthModule {}
