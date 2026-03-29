import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ResendService } from './resend.service';
import { ResendDomainService } from './resend-domain.service';
import { EmailProviderFactory } from './email-provider.factory';
import { SendGridModule } from '@/sendgrid/sendgrid.module';

@Module({
  imports: [ConfigModule, SendGridModule],
  providers: [ResendService, ResendDomainService, EmailProviderFactory],
  exports: [EmailProviderFactory, ResendDomainService],
})
export class EmailProvidersModule {}
