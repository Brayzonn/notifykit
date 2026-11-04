import { Module } from '@nestjs/common';
import { ResendEventsController } from './resend-events.controller';
import { ResendEventsService } from './resend-events.service';
import { ResendSignatureGuard } from './guards/resend-signature.guard';
import { ResendPlatformSignatureGuard } from './guards/resend-platform-signature.guard';
import { PrismaModule } from '@/prisma/prisma.module';
import { SuppressionModule } from '@/suppression/suppression.module';

@Module({
  imports: [PrismaModule, SuppressionModule],
  controllers: [ResendEventsController],
  providers: [
    ResendEventsService,
    ResendSignatureGuard,
    ResendPlatformSignatureGuard,
  ],
})
export class ResendEventsModule {}
