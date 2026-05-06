import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { BillingService } from './billing.service';
import { SubscriptionStatus } from '@prisma/client';

const PAST_DUE_GRACE_DAYS = 7;

@Injectable()
export class BillingCronService {
  private readonly logger = new Logger(BillingCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async downgradeStalePastDueSubscriptions(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PAST_DUE_GRACE_DAYS);

    const stale = await this.prisma.customer.findMany({
      where: {
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        lastPaymentDate: { lt: cutoff },
      },
      select: { id: true, email: true },
    });

    if (stale.length === 0) return;

    this.logger.log(
      `Downgrading ${stale.length} PAST_DUE customer(s) past ${PAST_DUE_GRACE_DAYS}-day grace period`,
    );

    for (const customer of stale) {
      try {
        await this.billingService.downgradeToFreePlan(customer.id, 'PAYMENT_FAILED');
        this.logger.warn(`Downgraded ${customer.email} to FREE (PAST_DUE > ${PAST_DUE_GRACE_DAYS} days)`);
      } catch (err) {
        this.logger.error(
          `Failed to downgrade ${customer.email}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
