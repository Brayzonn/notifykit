import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '@/prisma/prisma.service';
import { PaystackPaymentProvider } from '../providers/paystack-payment.provider';
import { JOB_NAMES, QUEUE_NAMES } from '@/queues/queue.constants';
import { PaystackSubscriptionLinkJobData } from '@/queues/queue.service';
import { getErrorMessage } from '@/common/utils/error.util';

@Processor(QUEUE_NAMES.PAYMENT_TASKS)
export class PaystackSubscriptionLinkProcessor extends WorkerHost {
  private readonly logger = new Logger(PaystackSubscriptionLinkProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackProvider: PaystackPaymentProvider,
  ) {
    super();
  }

  async process(job: Job<PaystackSubscriptionLinkJobData>) {
    if (job.name !== JOB_NAMES.LINK_PAYSTACK_SUBSCRIPTION) return;

    const { customerId, customerCode, customerNumericId, plan } = job.data;

    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          email: true,
          providerSubscriptionId: true,
        },
      });

      if (!customer) {
        this.logger.warn(`Customer ${customerId} not found, skipping link`);
        return;
      }

      if (customer.providerSubscriptionId) {
        this.logger.log(
          `Customer ${customer.email} already linked to subscription ${customer.providerSubscriptionId}`,
        );
        return;
      }

      const sub = await this.paystackProvider.findActiveSubscriptionByCustomer(
        customerNumericId ?? customerCode,
        plan,
      );

      if (!sub) {
        this.logger.error(
          `No active Paystack subscription found for customer ${customerCode} on plan ${plan}`,
        );
        return;
      }

      await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          providerSubscriptionId: sub.subscriptionCode,
          nextBillingDate: sub.nextBillingDate,
          subscriptionEndDate: sub.nextBillingDate,
          ...(sub.nextBillingDate && { usageResetAt: sub.nextBillingDate }),
        },
      });

      this.logger.log(
        `Linked Paystack subscription ${sub.subscriptionCode} for customer ${customer.email}`,
      );
    } catch (err) {
      this.logger.error(
        `Subscription link job failed for ${customerId}: ${getErrorMessage(err)}`,
      );
      throw err;
    }
  }
}
