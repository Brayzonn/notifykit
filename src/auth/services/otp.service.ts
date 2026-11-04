import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisService } from '@/redis/redis.service';
import {
  AuthRedisKeys,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS,
  OTP_TTL_SECONDS,
  OtpPurpose,
} from '@/auth/constants/auth.constants';

export type OtpCheckResult = 'valid' | 'missing' | 'mismatch' | 'locked';

const CONSUME_OTP_SCRIPT = `
  local attempts = tonumber(redis.call("GET", KEYS[2]) or "0")
  if attempts >= tonumber(ARGV[2]) then
    return "locked"
  end

  local stored = redis.call("GET", KEYS[1])
  if not stored then
    return "missing"
  end

  if redis.sha1hex(stored) == redis.sha1hex(ARGV[1]) then
    redis.call("DEL", KEYS[1], KEYS[2])
    return "valid"
  end

  local count = redis.call("INCR", KEYS[2])
  if count == 1 then
    redis.call("EXPIRE", KEYS[2], ARGV[3])
  end
  if count >= tonumber(ARGV[2]) then
    return "locked"
  end
  return "mismatch"
`;

const RELEASE_RESEND_SCRIPT = `
  if redis.call("EXISTS", KEYS[1]) == 1 then
    return redis.call("DECR", KEYS[1])
  end
  return 0
`;

@Injectable()
export class OtpService {
  constructor(private readonly redis: RedisService) {}

  generate(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  async store(purpose: OtpPurpose, email: string, otp: string): Promise<void> {
    await this.redis.set(
      AuthRedisKeys.otp(purpose, email),
      otp,
      OTP_TTL_SECONDS,
    );
  }

  async issue(purpose: OtpPurpose, email: string): Promise<string> {
    const otp = this.generate();
    await this.store(purpose, email, otp);
    return otp;
  }

  async consume(
    purpose: OtpPurpose,
    email: string,
    otp: string,
  ): Promise<OtpCheckResult> {
    const result = await this.redis.runScript(
      CONSUME_OTP_SCRIPT,
      [
        AuthRedisKeys.otp(purpose, email),
        AuthRedisKeys.otpAttempts(purpose, email),
      ],
      [otp, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS],
    );
    return result as OtpCheckResult;
  }

  async clear(purpose: OtpPurpose, email: string): Promise<void> {
    await this.redis.del(AuthRedisKeys.otp(purpose, email));
  }

  async reserveResend(email: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      AuthRedisKeys.otpResendCount(email),
      OTP_TTL_SECONDS,
    );

    if (count > OTP_MAX_RESENDS) {
      throw new BadRequestException(
        'Too many resend requests. Try again in 10 minutes.',
      );
    }
  }

  async releaseResend(email: string): Promise<void> {
    await this.redis.runScript(
      RELEASE_RESEND_SCRIPT,
      [AuthRedisKeys.otpResendCount(email)],
      [],
    );
  }
}
