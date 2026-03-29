import { Module } from '@nestjs/common';
import { ResendEventsController } from './resend-events.controller';
import { ResendEventsService } from './resend-events.service';
import { ResendSignatureGuard } from './guards/resend-signature.guard';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ResendEventsController],
  providers: [ResendEventsService, ResendSignatureGuard],
})
export class ResendEventsModule {}
