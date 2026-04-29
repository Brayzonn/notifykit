import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ResendService } from './resend.service';
import { ResendDomainService } from './resend-domain.service';
import { PostmarkService } from './postmark.service';
import { PostmarkDomainService } from './postmark-domain.service';
import { EmailProviderFactory } from './email-provider.factory';
import { SendGridModule } from '@/sendgrid/sendgrid.module';

@Module({
  imports: [ConfigModule, HttpModule, SendGridModule],
  providers: [
    ResendService,
    ResendDomainService,
    PostmarkService,
    PostmarkDomainService,
    EmailProviderFactory,
  ],
  exports: [EmailProviderFactory, ResendDomainService, PostmarkDomainService],
})
export class EmailProvidersModule {}
