import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ResendService } from './resend/resend.service';
import { ResendDomainService } from './resend/resend-domain.service';
import { PostmarkService } from './postmark/postmark.service';
import { PostmarkDomainService } from './postmark/postmark-domain.service';
import { EmailProviderFactory } from './email-provider.factory';
import { PlatformEmailSenderService } from './platform-email-sender.service';
import { SendGridModule } from './sendgrid/sendgrid.module';

@Module({
  imports: [ConfigModule, HttpModule, SendGridModule],
  providers: [
    ResendService,
    ResendDomainService,
    PostmarkService,
    PostmarkDomainService,
    EmailProviderFactory,
    PlatformEmailSenderService,
  ],
  exports: [
    EmailProviderFactory,
    ResendDomainService,
    PostmarkDomainService,
    PlatformEmailSenderService,
  ],
})
export class EmailProvidersModule {}
