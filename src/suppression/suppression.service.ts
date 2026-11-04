import { Injectable, Logger } from '@nestjs/common';
import { EmailEventType, SuppressedRecipient } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export interface SuppressionEvent {
  customerId: string;
  email: string | undefined | null;
  eventType: EmailEventType;
  hardBounce?: boolean;
}

@Injectable()
export class SuppressionService {
  private readonly logger = new Logger(SuppressionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async suppressFromEvent({
    customerId,
    email,
    eventType,
    hardBounce = false,
  }: SuppressionEvent): Promise<boolean> {
    if (!email) return false;

    const isSpamReport = eventType === EmailEventType.SPAM_REPORT;
    const isHardBounce = eventType === EmailEventType.BOUNCED && hardBounce;

    if (!isSpamReport && !isHardBounce) return false;

    await this.prisma.suppressedRecipient.upsert({
      where: { customerId_email: { customerId, email } },
      create: { customerId, email, reason: eventType },
      update: { reason: eventType },
    });

    this.logger.warn(
      `Suppressed recipient ${email} for customer ${customerId} (${eventType})`,
    );

    return true;
  }

  findSuppression(
    customerId: string,
    email: string,
  ): Promise<SuppressedRecipient | null> {
    return this.prisma.suppressedRecipient.findUnique({
      where: { customerId_email: { customerId, email } },
    });
  }
}
