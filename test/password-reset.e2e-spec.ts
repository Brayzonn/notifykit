import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/config/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { EmailService } from '../src/platform-email/email.service';
import { IpRateLimitGuard } from '../src/auth/guards/ip-rate-limit.guard';
import { AuthProvider } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  closeBullQueues,
  createMockEmailService,
  type MockedEmailService,
} from './helpers/test-utils';

describe('Password Reset Flow (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let prisma: PrismaService;
  let redis: RedisService;

  const mockEmailService: MockedEmailService = createMockEmailService();

  const testUser = {
    email: `reset-${Date.now()}@example.com`,
    password: 'OldPassword123!',
    name: 'Reset Test User',
    company: 'Test Corp',
  };

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue(mockEmailService)
      .overrideGuard(IpRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();

    configureApp(app);

    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    redis = moduleFixture.get<RedisService>(RedisService);
  });

  afterAll(async () => {
    await closeBullQueues(moduleFixture);
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.user.deleteMany({ where: { email: testUser.email } });

    await redis.del(`reset-password:${testUser.email}`);
    await redis.del(`otp-attempts:reset-password:${testUser.email}`);
  });

  const createVerifiedUser = async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(testUser);

    const otp = await redis.get(`otp:${testUser.email}`);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({ email: testUser.email, otp });

    const signinResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/signin')
      .send({
        email: testUser.email,
        password: testUser.password,
      });

    return signinResponse;
  };

  describe('Complete Password Reset Flow', () => {
    it('should complete password reset flow successfully', async () => {
      await createVerifiedUser();

      const requestResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(200);

      expect(requestResponse.body.data.message).toBe(
        'If this email exists, a reset code has been sent',
      );
      expect(mockEmailService.sendResetPasswordEmail).toHaveBeenCalled();

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);
      expect(resetOtp).toBeTruthy();
      expect(resetOtp).toMatch(/^\d{6}$/);

      const newPassword = 'NewPassword456!';
      const confirmResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword,
        })
        .expect(200);

      expect(confirmResponse.body.data.message).toBe(
        'Password reset successfully',
      );

      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      const isPasswordValid = await argon2.verify(user!.password!, newPassword);
      expect(isPasswordValid).toBe(true);

      const signinResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/signin')
        .send({
          email: testUser.email,
          password: newPassword,
        })
        .expect(200);

      expect(signinResponse.body.data).toHaveProperty('accessToken');
    });

    it('should delete all refresh tokens after password reset', async () => {
      const signinResponse = await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/signin')
        .send({ email: testUser.email, password: testUser.password });

      await request(app.getHttpServer())
        .post('/api/v1/auth/signin')
        .send({ email: testUser.email, password: testUser.password });

      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      const tokensBefore = await prisma.refreshToken.findMany({
        where: { userId: user!.id },
      });
      expect(tokensBefore.length).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'NewSecurePassword123!',
        });

      const tokensAfter = await prisma.refreshToken.findMany({
        where: { userId: user!.id },
      });
      expect(tokensAfter).toHaveLength(0);

      const oldRefreshToken = signinResponse.headers['set-cookie'][0];
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', oldRefreshToken)
        .expect(401);
    });

    it('should delete OTP from Redis after successful reset', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);
      expect(resetOtp).toBeTruthy();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'NewPassword789!',
        });

      const otpAfter = await redis.get(`reset-password:${testUser.email}`);
      expect(otpAfter).toBeNull();
    });
  });

  describe('Security: Information Disclosure Prevention', () => {
    it('should return generic message for non-existent email', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);

      expect(response.body.data.message).toBe(
        'If this email exists, a reset code has been sent',
      );
      expect(mockEmailService.sendResetPasswordEmail).not.toHaveBeenCalled();
    });

    it('should return generic message for unverified email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send(testUser);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(200);

      expect(response.body.data.message).toBe(
        'If this email exists, a reset code has been sent',
      );
      expect(mockEmailService.sendResetPasswordEmail).not.toHaveBeenCalled();
    });

    it('should return generic message for deleted account', async () => {
      await createVerifiedUser();

      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      await prisma.user.update({
        where: { id: user!.id },
        data: { deletedAt: new Date() },
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(200);

      expect(response.body.data.message).toBe(
        'If this email exists, a reset code has been sent',
      );
      expect(mockEmailService.sendResetPasswordEmail).not.toHaveBeenCalled();
    });
  });

  describe('Security: Invalid OTP Handling', () => {
    it('should reject invalid OTP', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: '000000',
          newPassword: 'NewPassword123!',
        })
        .expect(401);

      expect(response.body.error).toContain('Invalid or expired reset code');
    });

    it('should reject expired OTP', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      await redis.del(`reset-password:${testUser.email}`);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'NewPassword123!',
        })
        .expect(401);

      expect(response.body.error).toContain('Invalid or expired reset code');
    });

    const confirmReset = (otp: string | null) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp,
          newPassword: 'NewPassword123!',
        });

    const wrongOtpFor = (otp: string) =>
      otp === '000000' ? '111111' : '000000';

    it('should refuse even the correct code after 5 wrong guesses', async () => {
      await createVerifiedUser();
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });
      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      for (let i = 0; i < 5; i++) {
        await confirmReset(wrongOtpFor(resetOtp!)).expect(401);
      }

      const response = await confirmReset(resetOtp).expect(401);
      expect(response.body.error).toContain('Invalid or expired reset code');
      expect(await redis.get(`reset-password:${testUser.email}`)).toBe(
        resetOtp,
      );
    });

    it('should not reset the wrong-guess count when a new code is requested', async () => {
      await createVerifiedUser();
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });
      const firstOtp = await redis.get(`reset-password:${testUser.email}`);

      for (let i = 0; i < 5; i++) {
        await confirmReset(wrongOtpFor(firstOtp!)).expect(401);
      }

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });
      const secondOtp = await redis.get(`reset-password:${testUser.email}`);

      await confirmReset(secondOtp).expect(401);
    });

    it('should cap parallel wrong guesses at 5 counted attempts', async () => {
      await createVerifiedUser();
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });
      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      await Promise.all(
        Array.from({ length: 30 }, () => confirmReset(wrongOtpFor(resetOtp!))),
      );

      expect(
        await redis.get(`otp-attempts:reset-password:${testUser.email}`),
      ).toBe('5');
    });

    it('should reject if user not found', async () => {
      await redis.set('reset-password:ghost@example.com', '123456', 600);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: 'ghost@example.com',
          otp: '123456',
          newPassword: 'NewPassword123!',
        })
        .expect(401);

      expect(response.body.error).toContain('Invalid or expired reset code');

      await redis.del('reset-password:ghost@example.com');
    });
  });

  describe('Social Login Protection', () => {
    it('should prevent password reset for GitHub accounts', async () => {
      const hashedPassword = await argon2.hash('SomePassword123!');
      const githubUser = await prisma.user.create({
        data: {
          email: testUser.email,
          name: 'GitHub User',
          provider: AuthProvider.GITHUB,
          providerId: 'github-123',
          emailVerified: true,
          password: hashedPassword,
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(400);

      expect(response.body.error).toContain('social login');
      expect(mockEmailService.sendResetPasswordEmail).not.toHaveBeenCalled();

      await prisma.user.delete({ where: { id: githubUser.id } });
    });

    it('should prevent password reset for Google accounts', async () => {
      const hashedPassword = await argon2.hash('SomePassword123!');
      const googleUser = await prisma.user.create({
        data: {
          email: testUser.email,
          name: 'Google User',
          provider: AuthProvider.GOOGLE,
          providerId: 'google-456',
          emailVerified: true,
          password: hashedPassword,
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(400);

      expect(response.body.error).toContain('social login');

      await prisma.user.delete({ where: { id: googleUser.id } });
    });
  });

  describe('OTP Generation and Storage', () => {
    it('should generate 6-digit OTP', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);
      expect(resetOtp).toMatch(/^\d{6}$/);
      expect(resetOtp!.length).toBe(6);
    });

    it('should store OTP with 10-minute TTL', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      const ttl = await redis
        .getClient()
        .ttl(`reset-password:${testUser.email}`);
      expect(ttl).toBeGreaterThan(590);
      expect(ttl).toBeLessThanOrEqual(600);
    });

    it('should send email with OTP and expiry info', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      expect(mockEmailService.sendResetPasswordEmail).toHaveBeenCalledWith({
        email: testUser.email,
        otp: expect.stringMatching(/^\d{6}$/),
        expiresInMinutes: 10,
      });
    });
  });

  describe('Password Update Verification', () => {
    it('should hash new password with argon2', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);
      const newPassword = 'SecureNewPassword123!';

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword,
        });

      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      expect(user!.password).not.toBe(newPassword);
      expect(user!.password).toContain('$argon2');

      const isValid = await argon2.verify(user!.password!, newPassword);
      expect(isValid).toBe(true);
    });

    it('should not accept old password after reset', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'CompletelyNewPassword123!',
        });

      await request(app.getHttpServer())
        .post('/api/v1/auth/signin')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(401);
    });
  });

  describe('Validation', () => {
    it('should validate email format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: 'invalid-email' })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should validate new password strength', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'weak',
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });
});
