import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { RedisService } from '../../redis/redis.service';

interface CustomerRequest extends Request {
  customer: {
    id: string;
    email: string;
    plan: string;
  };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  // Rate limits per plan (requests per minute)
  private readonly rateLimits = {
    free: 10,
    indie: 100,
    startup: 500,
  };

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const customer = request.customer;

    if (!customer) {
      throw new HttpException(
        'Customer not authenticated',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const { id: customerId, plan } = customer;

    const isAllowed = await this.checkRateLimit(customerId, plan);

    if (!isAllowed) {
      const limit = this.rateLimits[plan] || this.rateLimits.free;
      this.logger.warn(`Rate limit exceeded for customer: ${customerId}`);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded',
          error: 'Too Many Requests',
          limit,
          window: '1 minute',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Check and increment rate limit counter
   */
  private async checkRateLimit(
    customerId: string,
    plan: string,
  ): Promise<boolean> {
    const key = `rate_limit:${customerId}:minute`;
    const limit = this.rateLimits[plan] || this.rateLimits.free;
    const ttl = 60; // 1 minute

    try {
      const currentCount = await this.redis.get(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      if (count >= limit) {
        return false;
      }

      if (count === 0) {
        await this.redis.set(key, '1', ttl);
      } else {
        const client = this.redis.getClient();
        await client.incr(key);
      }

      return true;
    } catch (error) {
      this.logger.error(`Rate limit check failed: ${error.message}`);
      return true;
    }
  }

  /**
   * Get remaining requests for a customer
   */
  async getRemainingRequests(
    customerId: string,
    plan: string,
  ): Promise<{ remaining: number; limit: number; resetIn: number }> {
    const key = `rate_limit:${customerId}:minute`;
    const limit = this.rateLimits[plan] || this.rateLimits.free;

    const currentCount = await this.redis.get(key);
    const count = currentCount ? parseInt(currentCount, 10) : 0;
    const remaining = Math.max(0, limit - count);

    // Get TTL
    const client = this.redis.getClient();
    const ttl = await client.ttl(key);
    const resetIn = ttl > 0 ? ttl : 60;

    return {
      remaining,
      limit,
      resetIn,
    };
  }
}
