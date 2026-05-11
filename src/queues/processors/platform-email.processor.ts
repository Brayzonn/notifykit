import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';
import { PlatformEmailSenderService } from '@/email-providers/platform-email-sender.service';
import { SlackService } from '@/common/slack/slack.service';
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

  constructor(
    private readonly sender: PlatformEmailSenderService,
    private readonly slack: SlackService,
  ) {
    super();
  }

  async process(job: Job<PlatformEmailJobData>): Promise<void> {
    const { to, subject, html, label } = job.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 3;

    this.logger.log(`Processing platform email [${label}] to ${to} (attempt ${attempt})`);

    try {
      await this.sender.send({ to, subject, html });
    } catch (err) {
      const msg = getErrorMessage(err);
      this.logger.error(`Platform email [${label}] to ${to} failed: ${msg}`);

      if (attempt >= maxAttempts) {
        this.logger.error(`Platform email [${label}] to ${to} exhausted all retries`);
        await this.slack.alert({
          title: ':rotating_light: Platform Email Failed',
          fields: [
            { label: 'Type', value: label },
            { label: 'Recipient', value: to },
            { label: 'Error', value: msg },
            { label: 'Attempts', value: `${attempt} / ${maxAttempts}` },
            { label: 'Time', value: new Date().toISOString() },
          ],
        });
      }

      throw err;
    }
  }
}
