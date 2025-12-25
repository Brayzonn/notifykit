import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

interface CustomerRequest extends Request {
  customer: {
    id: string;
    email: string;
    plan: string;
    monthlyLimit: number;
    usageCount: number;
    usageResetAt: Date;
  };
}

@Injectable()
export class QuotaGuard implements CanActivate {
  private readonly logger = new Logger(QuotaGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const customer = request.customer;

    if (!customer) {
      throw new HttpException(
        'Customer not authenticated',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Check if usage period needs reset
    const now = new Date();
    if (now > customer.usageResetAt) {
      await this.resetUsage(customer.id);
      customer.usageCount = 0;
      customer.usageResetAt = this.getNextResetDate();
    }

    // Check if quota exceeded
    if (customer.usageCount >= customer.monthlyLimit) {
      this.logger.warn(
        `Monthly quota exceeded for customer: ${customer.id} (${customer.usageCount}/${customer.monthlyLimit})`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Monthly quota exceeded',
          error: 'Quota Exceeded',
          usage: customer.usageCount,
          limit: customer.monthlyLimit,
          resetAt: customer.usageResetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Reset usage count for new billing period
   */
  private async resetUsage(customerId: string): Promise<void> {
    const nextResetDate = this.getNextResetDate();

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        usageCount: 0,
        usageResetAt: nextResetDate,
      },
    });

    this.logger.log(`Usage reset for customer: ${customerId}`);
  }

  /**
   * Calculate next reset date (1 month )
   */
  private getNextResetDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  /**
   * Get usage stats for a customer
   */
  async getUsageStats(customerId: string): Promise<{
    usage: number;
    limit: number;
    remaining: number;
    resetAt: Date;
    percentageUsed: number;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        usageCount: true,
        monthlyLimit: true,
        usageResetAt: true,
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
      percentageUsed: Math.round(percentageUsed * 100) / 100,
    };
  }
}
