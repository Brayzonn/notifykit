import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmailService } from '@/email/email.service';
import { SendGridModule } from '@/sendgrid/sendgrid.module';
import { EmailProvidersModule } from '@/email-providers/email-providers.module';
import { RedisModule } from '@/redis/redis.module';
import { EmailModule } from '@/email/email.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { EncryptionModule } from '@/common/encryption/encryption.module';

@Module({
  imports: [
    PrismaModule,
    SendGridModule,
    EmailProvidersModule,
    RedisModule,
    EmailModule,
    EncryptionModule,
    NotificationsModule,
  ],
  controllers: [UserController],
  providers: [UserService, EmailService],
  exports: [UserService],
})
export class UserModule {}
