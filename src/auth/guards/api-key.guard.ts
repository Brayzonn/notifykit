import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    if (!this.isValidApiKeyFormat(apiKey)) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const apiKeyHash = this.hashApiKey(apiKey);

    const customer = await this.prisma.customer.findUnique({
      where: { apiKeyHash },
      select: {
        id: true,
        email: true,
        plan: true,
        monthlyLimit: true,
        usageCount: true,
        usageResetAt: true,
      },
    });

    if (!customer) {
      this.logger.warn(`Invalid API key attempt: ${apiKey.substring(0, 8)}...`);
      throw new UnauthorizedException('Invalid API key');
    }

    request['customer'] = customer;

    this.logger.debug(`Authenticated customer: ${customer.email}`);
    return true;
  }

  /**
   * Extract API key from request headers
   */
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

  /**
   * Validate API key format (ntfy_xxxxx)
   */
  private isValidApiKeyFormat(apiKey: string): boolean {
    return /^ntfy_[a-zA-Z0-9]{32,}$/.test(apiKey);
  }

  /**
   * Hash API key using SHA256
   */
  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }
}
