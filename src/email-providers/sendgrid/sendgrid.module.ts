import { Module } from '@nestjs/common';
import { SendGridService } from './sendgrid.service';
import { SendGridDomainService } from './sendgrid-domain.service';

@Module({
  providers: [SendGridService, SendGridDomainService],
  exports: [SendGridService, SendGridDomainService],
})
export class SendGridModule {}
