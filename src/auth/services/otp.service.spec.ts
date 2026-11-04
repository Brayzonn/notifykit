import * as crypto from 'crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OtpService } from './otp.service';
import { RedisService } from '@/redis/redis.service';
import { createMockRedisService } from '../../../test/helpers/test-utils';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomInt: jest.fn(actual.randomInt),
  };
});

describe('OtpService', () => {
  let service: OtpService;
  let redis: ReturnType<typeof createMockRedisService>;
  const email = 'user@example.com';

  beforeEach(async () => {
    redis = createMockRedisService();
    const module = await Test.createTestingModule({
      providers: [OtpService, { provide: RedisService, useValue: redis }],
    }).compile();
    service = module.get(OtpService);
  });

  describe('generate', () => {
    it('uses crypto.randomInt for a 6-digit code', () => {
      const otp = service.generate();

      expect(crypto.randomInt).toHaveBeenCalledWith(100000, 1000000);
      expect(otp).toMatch(/^\d{6}$/);
    });
  });

  describe('issue', () => {
    it('stores a 6-digit signup OTP under the otp key for 10 minutes', async () => {
      const otp = await service.issue('signup', email);

      expect(otp).toMatch(/^\d{6}$/);
      expect(redis.set).toHaveBeenCalledWith(`otp:${email}`, otp, 600);
    });

    it('stores a reset OTP under the reset-password key', async () => {
      const otp = await service.issue('reset-password', email);

      expect(redis.set).toHaveBeenCalledWith(
        `reset-password:${email}`,
        otp,
        600,
      );
    });

    it('does not reset the wrong-guess counter for the new code', async () => {
      await service.issue('signup', email);

      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('consume', () => {
    it('runs one atomic script over the code and attempts keys', async () => {
      await service.consume('reset-password', email, '123456');

      expect(redis.runScript).toHaveBeenCalledWith(
        expect.any(String),
        [`reset-password:${email}`, `otp-attempts:reset-password:${email}`],
        ['123456', 5, 600],
      );
      expect(redis.get).not.toHaveBeenCalled();
    });

    it.each(['valid', 'missing', 'mismatch', 'locked'])(
      'returns the script result %s',
      async (result) => {
        redis.runScript.mockResolvedValue(result);

        await expect(service.consume('signup', email, '123456')).resolves.toBe(
          result,
        );
      },
    );
  });

  describe('clear', () => {
    it('deletes only the code, keeping the wrong-guess counter', async () => {
      await service.clear('signup', email);

      expect(redis.del).toHaveBeenCalledTimes(1);
      expect(redis.del).toHaveBeenCalledWith(`otp:${email}`);
    });
  });

  describe('reserveResend', () => {
    it('counts the resend atomically with a 10-minute expiry', async () => {
      redis.incrementWithTtl.mockResolvedValue(1);

      await expect(service.reserveResend(email)).resolves.toBeUndefined();
      expect(redis.incrementWithTtl).toHaveBeenCalledWith(
        `otp-resend:${email}`,
        600,
      );
    });

    it('allows the 3rd resend', async () => {
      redis.incrementWithTtl.mockResolvedValue(3);

      await expect(service.reserveResend(email)).resolves.toBeUndefined();
    });

    it('rejects the 4th resend', async () => {
      redis.incrementWithTtl.mockResolvedValue(4);

      await expect(service.reserveResend(email)).rejects.toThrow(
        new BadRequestException(
          'Too many resend requests. Try again in 10 minutes.',
        ),
      );
    });
  });

  describe('releaseResend', () => {
    it('gives back a reserved resend only if the counter still exists', async () => {
      await service.releaseResend(email);

      expect(redis.runScript).toHaveBeenCalledWith(
        expect.stringContaining('EXISTS'),
        [`otp-resend:${email}`],
        [],
      );
    });
  });
});
