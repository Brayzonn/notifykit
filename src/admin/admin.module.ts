import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { RateLimitModule } from '@/common/rate-limit/rate-limit.module';

@Module({
  imports: [PrismaModule, RateLimitModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
