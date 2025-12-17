import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import Redis from 'ioredis';

const redisClient =
  process.env.NODE_ENV === 'production'
    ? new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        enableOfflineQueue: false,
      })
    : null;

function createRateLimiter(config: {
  keyPrefix: string;
  points: number;
  duration: number;
}) {
  if (process.env.NODE_ENV === 'production' && redisClient) {
    return new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: config.keyPrefix,
      points: config.points,
      duration: config.duration,
    });
  } else {
    return new RateLimiterMemory({
      keyPrefix: config.keyPrefix,
      points: config.points,
      duration: config.duration,
    });
  }
}

const rateLimiters = {
  default: createRateLimiter({
    keyPrefix: 'default',
    points: 20,
    duration: 60,
  }),

  auth: createRateLimiter({
    keyPrefix: 'auth',
    points: 10,
    duration: 60,
  }),

  user: createRateLimiter({
    keyPrefix: 'user',
    points: 10,
    duration: 60,
  }),

  strict: createRateLimiter({
    keyPrefix: 'strict',
    points: 1,
    duration: 10,
  }),
};

export function createRateLimitMiddleware(
  type: keyof typeof rateLimiters = 'default',
  customMessage?: string,
) {
  @Injectable()
  class RateLimitMiddleware implements NestMiddleware {
    async use(req: Request, res: Response, next: NextFunction) {
      try {
        if (!req.ip) {
          throw new BadRequestException('Missing IP address');
        }

        await rateLimiters[type].consume(req.ip);
        next();
      } catch (rejRes) {
        const message = customMessage || `Too Many Requests (${type})`;
        console.log(`Rate limit exceeded for IP: ${req.ip}, type: ${type}`);
        throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  return RateLimitMiddleware;
}

@Injectable()
export class DefaultRateLimitMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.ip) {
        throw new BadRequestException('Missing IP address');
      }
      await rateLimiters.default.consume(req.ip);
      next();
    } catch (rejRes) {
      console.log(`Rate limit exceeded for IP: ${req.ip}`);
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

export const cleanupRateLimit = () => {
  if (redisClient) {
    redisClient.disconnect();
  }
};
