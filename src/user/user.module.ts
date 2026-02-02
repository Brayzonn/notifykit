import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmailService } from '@/email/email.service';
import { SendGridModule } from '@/sendgrid/sendgrid.module';
import { RedisModule } from '@/redis/redis.module';
import { EmailModule } from '@/email/email.module';

@Module({
  imports: [PrismaModule, SendGridModule, RedisModule, EmailModule],
  controllers: [UserController],
  providers: [UserService, EmailService],
  exports: [UserService],
})
export class UserModule {}
