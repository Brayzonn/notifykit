import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class PaymentWebhookEventService {
  private readonly logger = new Logger(PaymentWebhookEventService.name);

  constructor(private readonly prisma: PrismaService) {}

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
