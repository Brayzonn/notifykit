import { Module, Global } from '@nestjs/common';
import { EmailService } from './email.service';
import { QueueModule } from '@/queues/queue.module';

@Global()
@Module({
  imports: [QueueModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
