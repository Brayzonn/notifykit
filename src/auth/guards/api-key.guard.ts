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
        billingCycleStartAt: true,
        isActive: true,
        subscriptionStatus: true,
        paymentProvider: true,
        providerCustomerId: true,
        providerSubscriptionId: true,
        subscriptionEndDate: true,
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

    request.customer = {
      id: customer.id,
      email: customer.email,
      plan: customer.plan,
      monthlyLimit: customer.monthlyLimit,
      usageCount: customer.usageCount,
      usageResetAt: customer.usageResetAt,
      billingCycleStartAt: customer.billingCycleStartAt,
      subscriptionStatus: customer.subscriptionStatus ?? undefined,
      paymentProvider: customer.paymentProvider ?? undefined,
      providerCustomerId: customer.providerCustomerId ?? undefined,
      providerSubscriptionId: customer.providerSubscriptionId ?? undefined,
      subscriptionEndDate: customer.subscriptionEndDate ?? undefined,
    };

    this.logger.debug(`API key authenticated: ${customer.email}`);

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
}
