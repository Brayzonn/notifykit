import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import * as crypto from 'crypto';
import { CustomerPlan } from '@prisma/client';

export interface AuthenticatedCustomer {
  id: string;
  email: string;
  plan: CustomerPlan;
  monthlyLimit: number;
  usageCount: number;
  usageResetAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      customer?: AuthenticatedCustomer;
    }
  }
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly API_KEY_REGEX = /^nh_[a-f0-9]{64}$/;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'API key is missing',
        error: 'Unauthorized',
      });
    }

    if (!this.isValidApiKeyFormat(apiKey)) {
      this.logger.warn(`Invalid API key format: ${apiKey.substring(0, 11)}...`);
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid API key format',
        error: 'Unauthorized',
      });
    }

    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const customer = await this.prisma.customer.findUnique({
      where: { apiKeyHash },
      select: {
        id: true,
        email: true,
        plan: true,
        monthlyLimit: true,
        usageCount: true,
        usageResetAt: true,
        isActive: true,
        user: {
          select: {
            id: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!customer) {
      this.logger.warn(
        `Invalid API key attempt: ${apiKey.substring(0, 11)}...`,
      );
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid API key',
        error: 'Unauthorized',
      });
    }

    if (customer.user?.deletedAt) {
      this.logger.warn(`Deleted user attempted API access: ${customer.email}`);
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Account has been deleted',
        error: 'Forbidden',
      });
    }

    if (!customer.isActive) {
      this.logger.warn(
        `Inactive customer attempted API access: ${customer.email}`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Account is inactive',
        error: 'Forbidden',
      });
    }

    const now = new Date();
    if (customer.usageResetAt < now) {
      await this.resetMonthlyUsage(customer.id);
      customer.usageCount = 0;
      customer.usageResetAt = this.getNextResetDate();
      this.logger.log(`Reset monthly usage for customer: ${customer.email}`);
    }

    if (customer.usageCount >= customer.monthlyLimit) {
      this.logger.warn(
        `Usage limit exceeded for customer: ${customer.email} (${customer.usageCount}/${customer.monthlyLimit})`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        message: `Monthly usage limit exceeded (${customer.usageCount}/${customer.monthlyLimit}). Upgrade your plan or wait for reset on ${customer.usageResetAt.toLocaleDateString()}.`,
        error: 'Forbidden',
      });
    }

    const updatedCustomer = await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        usageCount: {
          increment: 1,
        },
      },
      select: {
        usageCount: true,
      },
    });

    request.customer = {
      id: customer.id,
      email: customer.email,
      plan: customer.plan,
      monthlyLimit: customer.monthlyLimit,
      usageCount: updatedCustomer.usageCount,
      usageResetAt: customer.usageResetAt,
    };

    this.logger.debug(
      `Authenticated customer: ${customer.email} (${updatedCustomer.usageCount}/${customer.monthlyLimit} used)`,
    );
    return true;
  }

  private extractApiKey(request: Request): string | null {
    const authHeader = request.headers['authorization'];
    const apiKeyHeader = request.headers['x-api-key'] as string;

    if (apiKeyHeader) {
      return apiKeyHeader;
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }

  private isValidApiKeyFormat(apiKey: string): boolean {
    return this.API_KEY_REGEX.test(apiKey);
  }

  private async resetMonthlyUsage(customerId: string): Promise<void> {
    const nextResetDate = this.getNextResetDate();

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        usageCount: 0,
        usageResetAt: nextResetDate,
      },
    });
  }

  private getNextResetDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }
}
