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
import { AuthenticatedCustomer } from '../interfaces/api-guard.interface';
import { PLAN_LIMITS } from '@/common/constants/plans.constants';

interface CustomerRequest extends Request {
  customer: AuthenticatedCustomer;
}

@Injectable()
export class CustomerRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(CustomerRateLimitGuard.name);
  private readonly windowSeconds = 60;

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
    const limit = PLAN_LIMITS[plan].rateLimit;

    const isAllowed = await this.checkRateLimit(customerId, limit);

    if (!isAllowed) {
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

  private async checkRateLimit(
    customerId: string,
    limit: number,
  ): Promise<boolean> {
    const key = `rate_limit:${customerId}:minute`;

    const script = `
      local current = redis.call("INCR", KEYS[1])
      if current == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
      end
      return current
    `;

    try {
      const client = this.redis.getClient();
      const count = await client.eval(
        script,
        1,
        key,
        this.windowSeconds.toString(),
      );

      if (Number(count) > limit) {
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Rate limit check failed: ${error.message}`);
      return true;
    }
  }
}
