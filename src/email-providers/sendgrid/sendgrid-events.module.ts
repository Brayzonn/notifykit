import { Module } from '@nestjs/common';
import { SendgridEventsController } from './sendgrid-events.controller';
import { SendgridEventsService } from './sendgrid-events.service';
import { SendgridSignatureGuard } from './guards/sendgrid-signature.guard';
import { SendgridCustomerSignatureGuard } from './guards/sendgrid-customer-signature.guard';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SendgridEventsController],
  providers: [
    SendgridEventsService,
    SendgridSignatureGuard,
    SendgridCustomerSignatureGuard,
  ],
})
export class SendgridEventsModule {}
