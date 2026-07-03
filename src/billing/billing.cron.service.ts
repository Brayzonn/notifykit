import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { BillingService } from './billing.service';
import { getErrorMessage } from '@/common/utils/error.util';
import { CustomerPlan, SubscriptionStatus } from '@prisma/client';

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
        await this.billingService.downgradeToFreePlan(
          customer.id,
          'PAYMENT_FAILED',
        );
        this.logger.warn(
          `Downgraded ${customer.email} to FREE (PAST_DUE > ${PAST_DUE_GRACE_DAYS} days)`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to downgrade ${customer.email}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Backstop for missed renewal webhooks. A paid subscription's billing window
   * only advances when the provider's renewal webhook fires. If that webhook is
   * ever dropped, the customer's window freezes in the past. This sweep finds
   * those frozen-but-ACTIVE customers and reconciles against the provider, which
   * is the source of truth for whether they actually renewed.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async reconcileStaleActiveSubscriptions(): Promise<void> {
    const now = new Date();

    const stale = await this.prisma.customer.findMany({
      where: {
        plan: { not: CustomerPlan.FREE },
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        usageResetAt: { lt: now },
        providerSubscriptionId: { not: null },
        paymentProvider: { not: null },
      },
      select: {
        id: true,
        email: true,
        providerSubscriptionId: true,
        paymentProvider: true,
      },
    });

    if (stale.length === 0) return;

    this.logger.log(
      `Reconciling ${stale.length} stale ACTIVE subscription(s) against provider`,
    );

    for (const customer of stale) {
      try {
        const cycle = await this.billingService.resolveProviderCycle(
          customer.providerSubscriptionId!,
          customer.paymentProvider!,
        );

        if (cycle.action === 'RENEWED') {
          await this.billingService.handleRenewalCharge(
            customer.id,
            cycle.periodEnd,
          );
          this.logger.log(
            `Reconcile: advanced billing window for ${customer.email} to ${cycle.periodEnd.toISOString()}`,
          );
          continue;
        }

        // LAPSED → genuine lapse; leave it for the expiry/downgrade flow.
        // UNKNOWN → provider unreachable or renewal not yet charged; retry next run.
        // Neither advances the cycle, so we never comp a free month.
        this.logger.warn(
          `Reconcile: ${customer.email} not advanced (provider says ${cycle.action}); skipping`,
        );
      } catch (err) {
        this.logger.error(
          `Reconcile failed for ${customer.email}: ${getErrorMessage(err)}`,
        );
      }
    }
  }
}
