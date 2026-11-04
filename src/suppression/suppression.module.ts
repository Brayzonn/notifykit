import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { SuppressionService } from './suppression.service';

@Module({
  imports: [PrismaModule],
  providers: [SuppressionService],
  exports: [SuppressionService],
})
export class SuppressionModule {}
