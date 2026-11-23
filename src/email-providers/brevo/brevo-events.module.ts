import { Module } from '@nestjs/common';
import { BrevoEventsController } from './brevo-events.controller';
import { BrevoEventsService } from './brevo-events.service';
import { BrevoSignatureGuard } from './guards/brevo-signature.guard';
import { BrevoPlatformSignatureGuard } from './guards/brevo-platform-signature.guard';
import { PrismaModule } from '@/prisma/prisma.module';
import { SuppressionModule } from '@/suppression/suppression.module';

@Module({
  imports: [PrismaModule, SuppressionModule],
  controllers: [BrevoEventsController],
  providers: [
    BrevoEventsService,
    BrevoSignatureGuard,
    BrevoPlatformSignatureGuard,
  ],
})
export class BrevoEventsModule {}
