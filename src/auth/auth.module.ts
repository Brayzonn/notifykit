import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './guards/api-key.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { QuotaGuard } from './guards/quota.guard';
import { RedisModule } from '@/redis/redis.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { EmailModule } from '@/email/email.module';
import { AuthController } from './auth.controller';
import { GithubStrategy } from './strategies/github.strategy';

@Module({
  imports: [
    RedisModule,
    EmailModule,
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
    RateLimitGuard,
    QuotaGuard,
    AuthService,
    JwtStrategy,
    GithubStrategy,
    JwtAuthGuard,
  ],
  exports: [AuthService, JwtAuthGuard, ApiKeyGuard, RateLimitGuard, QuotaGuard],
})
export class AuthModule {}
