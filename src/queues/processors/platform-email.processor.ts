import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';
import { PlatformEmailSenderService } from '@/email-providers/platform-email-sender.service';
import { SlackService } from '@/common/slack/slack.service';
import { getErrorMessage } from '@/common/utils/error.util';
import { PrismaService } from '@/prisma/prisma.service';

export interface PlatformEmailJobData {
  logId: string;
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
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<PlatformEmailJobData>): Promise<void> {
    const { logId, to, subject, html, label } = job.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 3;

    this.logger.log(`Processing platform email [${label}] to ${to} (attempt ${attempt})`);

    try {
      await this.sender.send({ to, subject, html });

      await this.prisma.platformEmailLog.update({
        where: { id: logId },
        data: { status: 'SENT', attempts: attempt, sentAt: new Date() },
      });
    } catch (err) {
      const msg = getErrorMessage(err);
      this.logger.error(`Platform email [${label}] to ${to} failed: ${msg}`);

      const isFinal = attempt >= maxAttempts;

      await this.prisma.platformEmailLog.update({
        where: { id: logId },
        data: {
          attempts: attempt,
          errorMessage: msg,
          ...(isFinal && { status: 'FAILED' }),
        },
      });

      if (isFinal) {
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
