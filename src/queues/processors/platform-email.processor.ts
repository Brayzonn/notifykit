import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';
import { PlatformEmailSenderService } from '@/email-providers/platform-email-sender.service';
import { getErrorMessage } from '@/common/utils/error.util';

export interface PlatformEmailJobData {
  to: string;
  subject: string;
  html: string;
  label: string;
}

@Processor(QUEUE_NAMES.PLATFORM_EMAIL)
export class PlatformEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(PlatformEmailProcessor.name);

  constructor(private readonly sender: PlatformEmailSenderService) {
    super();
  }

  async process(job: Job<PlatformEmailJobData>): Promise<void> {
    const { to, subject, html, label } = job.data;

    this.logger.log(`Processing platform email [${label}] to ${to} (attempt ${job.attemptsMade + 1})`);

    try {
      await this.sender.send({ to, subject, html });
    } catch (err) {
      const msg = getErrorMessage(err);
      this.logger.error(`Platform email [${label}] to ${to} failed: ${msg}`);

      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 3)) {
        this.logger.error(`Platform email [${label}] to ${to} exhausted all retries`);
      }

      throw err;
    }
  }
}
