import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SendGridDomainService } from '../sendgrid/sendgrid-domain.service';
import { CustomerPlan, Prisma, SubscriptionStatus } from '@prisma/client';
import { getPlanLimit } from '@/common/constants/plans.constants';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sendGridDomainService: SendGridDomainService,
  ) {}

  /**
   * Request domain verification
   */
  async requestDomainVerification(customerId: string, domain: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        plan: true,
        sendgridDomainId: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === CustomerPlan.FREE) {
      throw new BadRequestException(
        'Custom domain is only available for paid plans (Indie, Startup)',
      );
    }

    const domainRegex =
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

    if (!domainRegex.test(domain)) {
      throw new BadRequestException('Invalid domain format');
    }

    const existingDomain = await this.prisma.customer.findFirst({
      where: {
        sendingDomain: domain,
        domainVerified: true,
        id: { not: customerId },
      },
    });

    if (existingDomain) {
      throw new BadRequestException(
        'This domain is already verified by another customer',
      );
    }

    if (customer.sendgridDomainId) {
      try {
        await this.sendGridDomainService.deleteDomain(
          parseInt(customer.sendgridDomainId),
        );
      } catch (error) {
        this.logger.warn(`Failed to delete old domain: ${error.message}`);
      }
    }

    const { domainId, dnsRecords, valid } =
      await this.sendGridDomainService.authenticateDomain(domain);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        sendingDomain: domain,
        sendgridDomainId: domainId.toString(),
        domainDnsRecords: dnsRecords,
        domainVerified: valid,
        domainRequestedAt: new Date(),
        domainVerifiedAt: valid ? new Date() : null,
      },
    });

    this.logger.log(
      `Domain verification requested: ${domain} for customer: ${customerId}`,
    );

    return {
      domain,
      status: valid ? 'verified' : 'pending',
      dnsRecords: dnsRecords.map((record, index) => ({
        id: index + 1,
        type: record.type,
        host: record.host,
        value: record.value,
        description: this.getDnsRecordDescription(index),
      })),
      instructions: {
        message: 'Add these DNS records to your domain registrar',
        steps: [
          '1. Login to your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.)',
          '2. Navigate to DNS settings for your domain',
          '3. Add each CNAME record below',
          '4. Wait 15-60 minutes for DNS propagation',
          '5. Click "Verify Domain" to check status',
        ],
        estimatedTime: '15-60 minutes',
      },
    };
  }

  /**
   * Check domain verification status
   */
  async checkDomainVerification(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        sendingDomain: true,
        domainVerified: true,
        sendgridDomainId: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (!customer.sendgridDomainId) {
      throw new NotFoundException(
        'No domain configured. Please add a domain first.',
      );
    }

    const { valid, validationResults } =
      await this.sendGridDomainService.validateDomain(
        parseInt(customer.sendgridDomainId),
      );

    if (valid && !customer.domainVerified) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: {
          domainVerified: true,
          domainVerifiedAt: new Date(),
        },
      });

      this.logger.log(
        `Domain verified: ${customer.sendingDomain} for customer: ${customerId}`,
      );
    }

    return {
      domain: customer.sendingDomain,
      verified: valid,
      message: valid
        ? 'Domain verified! You can now send emails from this domain.'
        : 'Domain not yet verified. DNS records may still be propagating (15-60 minutes).',
      validationResults: valid ? null : validationResults,
    };
  }

  /**
   * Get domain status
   */
  async getDomainStatus(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        sendingDomain: true,
        domainVerified: true,
        domainDnsRecords: true,
        domainRequestedAt: true,
        domainVerifiedAt: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (!customer.sendingDomain) {
      return {
        status: false,
        message: 'No custom domain configured',
      };
    }

    return {
      domain: customer.sendingDomain,
      verified: customer.domainVerified,
      status: customer.domainVerified ? 'verified' : 'pending',
      dnsRecords: customer.domainDnsRecords,
      requestedAt: customer.domainRequestedAt,
      verifiedAt: customer.domainVerifiedAt,
    };
  }

  /**
   * Remove domain verification
   */
  async removeDomain(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.sendgridDomainId) {
      try {
        await this.sendGridDomainService.deleteDomain(
          parseInt(customer.sendgridDomainId),
        );
      } catch (error) {
        this.logger.warn(
          `Failed to delete domain from SendGrid: ${error.message}`,
        );
      }
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        sendingDomain: null,
        domainVerified: false,
        sendgridDomainId: null,
        domainDnsRecords: Prisma.JsonNull,
        domainRequestedAt: null,
        domainVerifiedAt: null,
      },
    });

    this.logger.log(`Domain removed for customer: ${customerId}`);

    return { message: 'Domain removed successfully' };
  }

  /**
   * downgrade customer to free plan
   */
  async downgradeToFreePlan(
    customerId: string,
    reason: 'SUBSCRIPTION_EXPIRED' | 'PAYMENT_FAILED',
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { plan: true, email: true },
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    const originalPlan = customer.plan;
    const now = new Date();

    const resetDate = new Date(now);
    resetDate.setDate(resetDate.getDate() + 30);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        plan: CustomerPlan.FREE,
        monthlyLimit: getPlanLimit(CustomerPlan.FREE),
        usageCount: 0,
        usageResetAt: resetDate,
        billingCycleStartAt: now,
        previousPlan: originalPlan,
        downgradedAt: now,
        subscriptionStatus: SubscriptionStatus.EXPIRED,
      },
    });

    //do later-------send user downgrade email--------------------------------------

    this.logger.warn(
      `Customer ${customer.email} downgraded from ${originalPlan} to FREE. Next reset: ${resetDate.toISOString()}`,
    );
  }

  /**
   * Reset customer usage for new billing cycle
   */
  async resetMonthlyUsage(customerId: string): Promise<void> {
    const resetDate = new Date();
    resetDate.setDate(resetDate.getDate() + 30); // 30 days from now

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        usageCount: 0,
        usageResetAt: resetDate,
        billingCycleStartAt: new Date(),
      },
    });

    this.logger.log(
      `Reset usage for customer ${customerId}. Next reset: ${resetDate.toISOString()}`,
    );
  }

  /**
   * Get usage stats for a customer
   */
  async getUsageStats(customerId: string): Promise<{
    usage: number;
    limit: number;
    remaining: number;
    resetAt: Date;
    billingCycleStartAt: Date;
    percentageUsed: number;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        usageCount: true,
        monthlyLimit: true,
        usageResetAt: true,
        billingCycleStartAt: true,
      },
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    const remaining = Math.max(0, customer.monthlyLimit - customer.usageCount);
    const percentageUsed = (customer.usageCount / customer.monthlyLimit) * 100;

    return {
      usage: customer.usageCount,
      limit: customer.monthlyLimit,
      remaining,
      resetAt: customer.usageResetAt,
      billingCycleStartAt: customer.billingCycleStartAt,
      percentageUsed: Math.round(percentageUsed * 100) / 100,
    };
  }

  /**
   * Increment usage counter
   */
  async incrementUsage(customerId: string): Promise<void> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { usageCount: { increment: 1 } },
    });
  }

  private getDnsRecordDescription(index: number): string {
    const descriptions = [
      'Mail CNAME - Routes email through SendGrid',
      'DKIM 1 - Email authentication (prevents spoofing)',
      'DKIM 2 - Email authentication (backup)',
    ];
    return descriptions[index] || 'DNS Record';
  }
}
