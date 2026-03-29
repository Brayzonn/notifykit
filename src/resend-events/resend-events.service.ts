import { Injectable, Logger } from '@nestjs/common';
import { EmailEventType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    tags?: Record<string, string>;
    [key: string]: unknown;
  };
}

const EVENT_MAP: Record<string, EmailEventType> = {
  'email.delivered': EmailEventType.DELIVERED,
  'email.opened': EmailEventType.OPENED,
  'email.clicked': EmailEventType.CLICKED,
  'email.bounced': EmailEventType.BOUNCED,
  'email.complained': EmailEventType.SPAM_REPORT,
  'email.delivery_delayed': EmailEventType.DEFERRED,
};

@Injectable()
export class ResendEventsService {
  private readonly logger = new Logger(ResendEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async processEvent(event: ResendWebhookEvent): Promise<void> {
    const eventType = EVENT_MAP[event.type];
    if (!eventType) {
      this.logger.debug(`Ignoring untracked Resend event type: ${event.type}`);
      return;
    }

    const jobId = event.data.tags?.job_id;
    if (!jobId) {
      this.logger.debug(
        `Skipping Resend event ${event.type} — no job_id tag`,
      );
      return;
    }

    const jobExists = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true },
    });

    if (!jobExists) {
      this.logger.warn(
        `Received Resend event for unknown job_id: ${jobId}`,
      );
      return;
    }

    const email = Array.isArray(event.data.to)
      ? event.data.to[0]
      : event.data.to;

    const occurredAt = new Date(event.created_at);
    const dedupeKey = `${event.data.email_id}:${eventType}`;

    const { email_id, tags, from, to, subject, created_at, ...rest } =
      event.data;

    try {
      await this.prisma.emailEvent.upsert({
        where: { eventId: dedupeKey },
        create: {
          jobId,
          event: eventType,
          email,
          eventId: dedupeKey,
          metadata: Object.keys(rest).length
            ? (rest as Prisma.InputJsonObject)
            : undefined,
          occurredAt,
        },
        update: {},
      });

      this.logger.debug(`Recorded ${eventType} event for job ${jobId}`);
    } catch (error) {
      this.logger.error(
        `Failed to store Resend event for job ${jobId}: ${error.message}`,
      );
    }
  }
}
