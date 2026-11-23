import { Injectable, Logger } from '@nestjs/common';
import { EmailEventType, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { findEmailEventJob } from '../email-event-job.util';
import { getErrorMessage } from '@/common/utils/error.util';
import { SuppressionService } from '@/suppression/suppression.service';
import { BREVO_JOB_TAG_PREFIX } from './brevo.service';

export interface BrevoWebhookEvent {
  event: string;
  email?: string;
  'message-id'?: string;
  tags?: string[];
  tag?: string;
  ts?: number;
  ts_event?: number;
  [key: string]: unknown;
}

const EVENT_MAP: Record<string, EmailEventType> = {
  delivered: EmailEventType.DELIVERED,
  opened: EmailEventType.OPENED,
  click: EmailEventType.CLICKED,
  hard_bounce: EmailEventType.BOUNCED,
  soft_bounce: EmailEventType.BOUNCED,
  invalid_email: EmailEventType.BOUNCED,
  spam: EmailEventType.SPAM_REPORT,
  unsubscribed: EmailEventType.UNSUBSCRIBED,
  deferred: EmailEventType.DEFERRED,
};

const HARD_BOUNCE_EVENTS = new Set(['hard_bounce', 'invalid_email']);

@Injectable()
export class BrevoEventsService {
  private readonly logger = new Logger(BrevoEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly suppression: SuppressionService,
  ) {}

  async processEvents(
    customerId: string | undefined,
    body: BrevoWebhookEvent | BrevoWebhookEvent[],
  ): Promise<void> {
    const events = Array.isArray(body) ? body : [body];
    for (const event of events) {
      await this.processEvent(customerId, event);
    }
  }

  private async processEvent(
    customerId: string | undefined,
    event: BrevoWebhookEvent,
  ): Promise<void> {
    const eventType = EVENT_MAP[event?.event];
    if (!eventType) {
      this.logger.debug(`Ignoring untracked Brevo event type: ${event?.event}`);
      return;
    }

    const jobId = this.extractJobId(event);
    if (!jobId) {
      this.logger.debug(`Skipping Brevo event ${event.event} — no job_id`);
      return;
    }

    const job = await findEmailEventJob(this.prisma, jobId, customerId);

    if (!job) {
      this.logger.warn(
        customerId
          ? `Received Brevo event for job_id ${jobId} not owned by customer ${customerId}`
          : `Received Brevo event for unknown job_id: ${jobId}`,
      );
      return;
    }

    const email = event.email ?? '';
    const timestampSeconds = event.ts_event ?? event.ts;
    const occurredAt =
      typeof timestampSeconds === 'number'
        ? new Date(timestampSeconds * 1000)
        : new Date();

    const messageRef = event['message-id'] ?? jobId;
    const dedupeKey =
      typeof timestampSeconds === 'number'
        ? `${messageRef}:${event.event}:${timestampSeconds}`
        : `${messageRef}:${event.event}`;

    const {
      event: _event,
      email: _email,
      'message-id': _messageId,
      tags: _tags,
      tag: _tag,
      ts: _ts,
      ts_event: _tsEvent,
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

      await this.suppression.suppressFromEvent({
        customerId: job.customerId,
        email,
        eventType,
        hardBounce: HARD_BOUNCE_EVENTS.has(event.event),
      });
    } catch (error) {
      this.logger.error(
        `Failed to store Brevo event for job ${jobId}: ${getErrorMessage(error)}`,
      );
    }
  }

  private extractJobId(event: BrevoWebhookEvent): string | undefined {
    const tags = [
      ...(Array.isArray(event.tags) ? event.tags : []),
      ...(typeof event.tag === 'string' ? [event.tag] : []),
    ];
    const tagged = tags.find(
      (t) => typeof t === 'string' && t.startsWith(BREVO_JOB_TAG_PREFIX),
    );
    return tagged?.substring(BREVO_JOB_TAG_PREFIX.length);
  }
}
