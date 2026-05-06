import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class PaymentWebhookEventService {
  private readonly logger = new Logger(PaymentWebhookEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a webhook event for idempotency. Returns `true` if this is the
   * first time we've seen this (provider, eventId), `false` if a duplicate.
   * The handler should short-circuit on `false` so retries don't re-apply
   * partial work.
   */
  async markProcessed(
    provider: PaymentProvider,
    eventId: string,
    eventType: string,
    payload: unknown,
  ): Promise<boolean> {
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: {
          provider,
          eventId,
          eventType,
          payload: payload as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.log(
          `Duplicate ${provider} webhook event skipped: ${eventType} ${eventId}`,
        );
        return false;
      }
      throw err;
    }
  }

  /**
   * Removes a previously recorded dedup entry so that a failed event can be
   * retried. Called from the catch block of the webhook handler when processing
   * throws after the dedup record was already written.
   */
  async unmarkProcessed(
    provider: PaymentProvider,
    eventId: string,
  ): Promise<void> {
    try {
      await this.prisma.paymentWebhookEvent.delete({
        where: { provider_eventId: { provider, eventId } },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to remove dedup record for ${provider}:${eventId} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
