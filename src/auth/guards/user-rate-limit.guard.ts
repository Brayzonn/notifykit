import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';
import { Request } from 'express';
import { UserRole, CustomerPlan } from '@prisma/client';
import { getPlanRateLimit } from '@/common/constants/plans.constants';

interface UserRequest extends Request {
  user: {
    id: string;
    email: string;
    role: UserRole;
    plan: CustomerPlan;
  };
}

@Injectable()
export class UserRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(UserRateLimitGuard.name);
  private readonly windowSeconds = 60;

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserRequest>();
    const user = request.user;

    if (!user) {
      throw new HttpException(
        'User not authenticated',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isAllowed = await this.checkRateLimit(user.id, user.plan);

    if (!isAllowed) {
      const limit = getPlanRateLimit(user.plan);

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
   * Atomic rate limit check
   */

  private async checkRateLimit(
    userId: string,
    plan: CustomerPlan,
  ): Promise<boolean> {
    const key = `rate_limit:user:${userId}:1m`;
    const limit = getPlanRateLimit(plan);

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
        this.logger.warn(`Rate limit exceeded for user ${userId}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Rate limit failed: ${error.message}`);
      return true;
    }
  }
}
