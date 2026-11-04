import { Module } from '@nestjs/common';
import { PostmarkEventsController } from './postmark-events.controller';
import { PostmarkEventsService } from './postmark-events.service';
import { PostmarkSignatureGuard } from './guards/postmark-signature.guard';
import { PrismaModule } from '@/prisma/prisma.module';
import { SuppressionModule } from '@/suppression/suppression.module';

@Module({
  imports: [PrismaModule, SuppressionModule],
  controllers: [PostmarkEventsController],
  providers: [PostmarkEventsService, PostmarkSignatureGuard],
})
export class PostmarkEventsModule {}
