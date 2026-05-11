import { Injectable, Logger } from '@nestjs/common';
import { EmailEventType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { getErrorMessage } from '@/common/utils/error.util';

interface PostmarkWebhookEvent {
  RecordType: string;
  MessageID?: string;
  Recipient?: string;
  Email?: string;
  ReceivedAt?: string;
  DeliveredAt?: string;
  BouncedAt?: string;
  ChangedAt?: string;
  Metadata?: Record<string, string>;
  SuppressSending?: boolean;
  [key: string]: unknown;
}

const EVENT_MAP: Record<string, EmailEventType> = {
  Delivery: EmailEventType.DELIVERED,
  Open: EmailEventType.OPENED,
  Click: EmailEventType.CLICKED,
  Bounce: EmailEventType.BOUNCED,
  SpamComplaint: EmailEventType.SPAM_REPORT,
  SubscriptionChange: EmailEventType.UNSUBSCRIBED,
};

@Injectable()
export class PostmarkEventsService {
  private readonly logger = new Logger(PostmarkEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async processEvent(event: PostmarkWebhookEvent): Promise<void> {
    const eventType = EVENT_MAP[event.RecordType];
    if (!eventType) {
      this.logger.debug(
        `Ignoring untracked Postmark event type: ${event.RecordType}`,
      );
      return;
    }

    const jobId = event.Metadata?.job_id;
    if (!jobId) {
      this.logger.debug(
        `Skipping Postmark event ${event.RecordType} — no job_id metadata`,
      );
      return;
    }

    const jobExists = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true },
    });

    if (!jobExists) {
      this.logger.warn(`Received Postmark event for unknown job_id: ${jobId}`);
      return;
    }

    const email = event.Recipient ?? event.Email ?? '';
    const occurredAt = new Date(
      event.DeliveredAt ??
        event.BouncedAt ??
        event.ChangedAt ??
        event.ReceivedAt ??
        Date.now(),
    );

    const dedupeKey = `${event.MessageID ?? jobId}:${event.RecordType}:${occurredAt.getTime()}`;

    const {
      RecordType,
      MessageID,
      Recipient,
      Email,
      ReceivedAt,
      DeliveredAt,
      BouncedAt,
      ChangedAt,
      Metadata,
      ...rest
    } = event;

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
        `Failed to store Postmark event for job ${jobId}: ${getErrorMessage(error)}`,
      );
    }
  }
}
