import { Injectable, Logger } from '@nestjs/common';
import { EmailEventType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

interface SendgridRawEvent {
  email: string;
  timestamp: number;
  event: string;
  sg_event_id?: string;
  job_id?: string;
  [key: string]: unknown;
}

const EVENT_MAP: Record<string, EmailEventType> = {
  delivered: EmailEventType.DELIVERED,
  open: EmailEventType.OPENED,
  click: EmailEventType.CLICKED,
  bounce: EmailEventType.BOUNCED,
  spamreport: EmailEventType.SPAM_REPORT,
  unsubscribe: EmailEventType.UNSUBSCRIBED,
  deferred: EmailEventType.DEFERRED,
};

@Injectable()
export class SendgridEventsService {
  private readonly logger = new Logger(SendgridEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async processEvents(events: SendgridRawEvent[]): Promise<void> {
    if (!Array.isArray(events)) return;

    for (const event of events) {
      const eventType = EVENT_MAP[event.event];
      if (!eventType) continue;

      const jobId = event.job_id;
      if (!jobId) {
        this.logger.debug(
          `Skipping event ${event.event} — no job_id custom arg`,
        );
        continue;
      }

      const jobExists = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true },
      });

      if (!jobExists) {
        this.logger.warn(
          `Received SendGrid event for unknown job_id: ${jobId}`,
        );
        continue;
      }

      const { email, timestamp, sg_event_id, job_id, event: _, ...rest } =
        event;

      const resolvedSgEventId =
        sg_event_id ?? `${jobId}:${eventType}:${timestamp}`;

      try {
        await this.prisma.emailEvent.upsert({
          where: { eventId: resolvedSgEventId },
          create: {
            jobId,
            event: eventType,
            email,
            eventId: resolvedSgEventId,
            metadata: Object.keys(rest).length
              ? (rest as Prisma.InputJsonObject)
              : undefined,
            occurredAt: new Date(timestamp * 1000),
          },
          update: {},
        });

        this.logger.debug(`Recorded ${eventType} event for job ${jobId}`);
      } catch (error) {
        this.logger.error(
          `Failed to store email event for job ${jobId}: ${error.message}`,
        );
      }
    }
  }
}
