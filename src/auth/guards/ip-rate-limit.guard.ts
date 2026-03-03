import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RedisService } from '@/redis/redis.service';
import {
  IP_RATE_LIMIT_KEY,
  IpRateLimitOptions,
} from '@/auth/decorators/ip-rate-limit.decorator';

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(IpRateLimitGuard.name);

  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<IpRateLimitOptions>(
      IP_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const ip = request.ip || 'unknown';
    const handlerName = context.getHandler().name;
    const key = `ip_rl:${ip}:${handlerName}`;

    const isAllowed = await this.checkRateLimit(
      key,
      config.limit,
      config.windowSeconds,
    );

    if (!isAllowed) {
      response.set('Retry-After', String(config.windowSeconds));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          error: 'Too Many Requests',
          retryAfter: config.windowSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
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
        windowSeconds.toString(),
      );

      if (Number(count) > limit) {
        this.logger.warn(`IP rate limit exceeded for key: ${key}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`IP rate limit check failed: ${error.message}`);
      return true;
    }
  }
}
