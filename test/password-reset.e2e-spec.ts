import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { EmailService } from '../src/email/email.service';
import { AuthProvider } from '@prisma/client';
import * as argon2 from 'argon2';

describe('Password Reset Flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let emailService: jest.Mocked<EmailService>;

  const mockEmailService = {
    sendOtpEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
    sendResetPasswordEmail: jest.fn(),
  };

  const testUser = {
    email: `reset-${Date.now()}@example.com`,
    password: 'OldPassword123!',
    name: 'Reset Test User',
    company: 'Test Corp',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue(mockEmailService)
      .compile();

    app = moduleFixture.createNestApplication();

    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    redis = moduleFixture.get<RedisService>(RedisService);
    emailService = moduleFixture.get(EmailService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    // Cleanup test data
    await prisma.refreshToken.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.user.deleteMany({ where: { email: testUser.email } });

    // Clear Redis keys
    await redis.del(`reset-password:${testUser.email}`);
  });

  const createVerifiedUser = async () => {
    // Signup
    await request(app.getHttpServer()).post('/auth/signup').send(testUser);

    // Verify OTP
    const otp = await redis.get(`otp:${testUser.email}`);
    await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ email: testUser.email, otp });

    // Sign in to create refresh tokens
    const signinResponse = await request(app.getHttpServer())
      .post('/auth/signin')
      .send({
        email: testUser.email,
        password: testUser.password,
      });

    return signinResponse;
  };

  describe('Complete Password Reset Flow', () => {
    it('should complete password reset flow successfully', async () => {
      await createVerifiedUser();

      // Step 1: Request password reset
      const requestResponse = await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(200);

      expect(requestResponse.body.message).toBe(
        'If this email exists, a reset code has been sent',
      );
      expect(mockEmailService.sendResetPasswordEmail).toHaveBeenCalled();

      // Check OTP stored in Redis
      const resetOtp = await redis.get(`reset-password:${testUser.email}`);
      expect(resetOtp).toBeTruthy();
      expect(resetOtp).toMatch(/^\d{6}$/);

      // Step 2: Confirm password reset with OTP
      const newPassword = 'NewPassword456!';
      const confirmResponse = await request(app.getHttpServer())
        .post('/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword,
        })
        .expect(200);

      expect(confirmResponse.body.message).toBe('Password reset successfully');

      // Verify password updated in database
      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      const isPasswordValid = await argon2.verify(user!.password!, newPassword);
      expect(isPasswordValid).toBe(true);

      // Verify can sign in with new password
      const signinResponse = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({
          email: testUser.email,
          password: newPassword,
        })
        .expect(200);

      expect(signinResponse.body).toHaveProperty('accessToken');
    });

    it('should delete all refresh tokens after password reset', async () => {
      const signinResponse = await createVerifiedUser();

      // Create multiple sessions
      await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: testUser.email, password: testUser.password });

      await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: testUser.email, password: testUser.password });

      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      // Verify multiple refresh tokens exist
      const tokensBefore = await prisma.refreshToken.findMany({
        where: { userId: user!.id },
      });
      expect(tokensBefore.length).toBeGreaterThan(0);

      // Request and confirm password reset
      await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      await request(app.getHttpServer())
        .post('/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'NewSecurePassword123!',
        });

      // Verify all refresh tokens deleted
      const tokensAfter = await prisma.refreshToken.findMany({
        where: { userId: user!.id },
      });
      expect(tokensAfter).toHaveLength(0);

      // Old refresh token should not work
      const oldRefreshToken = signinResponse.headers['set-cookie'][0];
      await request(app.getHttpServer())
        .post('/auth/refresh-token')
        .set('Cookie', oldRefreshToken)
        .expect(401);
    });

    it('should delete OTP from Redis after successful reset', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);
      expect(resetOtp).toBeTruthy();

      await request(app.getHttpServer())
        .post('/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'NewPassword789!',
        });

      // OTP should be deleted
      const otpAfter = await redis.get(`reset-password:${testUser.email}`);
      expect(otpAfter).toBeNull();
    });
  });

  describe('Security: Information Disclosure Prevention', () => {
    it('should return generic message for non-existent email', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);

      expect(response.body.message).toBe(
        'If this email exists, a reset code has been sent',
      );
      expect(mockEmailService.sendResetPasswordEmail).not.toHaveBeenCalled();
    });

    it('should return generic message for unverified email', async () => {
      // Create unverified user
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      const response = await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(200);

      expect(response.body.message).toBe(
        'If this email exists, a reset code has been sent',
      );
      expect(mockEmailService.sendResetPasswordEmail).not.toHaveBeenCalled();
    });

    it('should return generic message for deleted account', async () => {
      await createVerifiedUser();

      // Soft delete user
      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      await prisma.user.update({
        where: { id: user!.id },
        data: { deletedAt: new Date() },
      });

      const response = await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(200);

      expect(response.body.message).toBe(
        'If this email exists, a reset code has been sent',
      );
      expect(mockEmailService.sendResetPasswordEmail).not.toHaveBeenCalled();
    });
  });

  describe('Security: Invalid OTP Handling', () => {
    it('should reject invalid OTP', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email });

      const response = await request(app.getHttpServer())
        .post('/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: '000000',
          newPassword: 'NewPassword123!',
        })
        .expect(401);

      expect(response.body.message).toContain('Invalid or expired reset code');
    });

    it('should reject expired OTP', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      // Manually delete OTP to simulate expiration
      await redis.del(`reset-password:${testUser.email}`);

      const response = await request(app.getHttpServer())
        .post('/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'NewPassword123!',
        })
        .expect(401);

      expect(response.body.message).toContain('Invalid or expired reset code');
    });

    it('should reject if user not found', async () => {
      // Set OTP in Redis without creating user
      await redis.set('reset-password:ghost@example.com', '123456', 600);

      const response = await request(app.getHttpServer())
        .post('/auth/reset-password/confirm')
        .send({
          email: 'ghost@example.com',
          otp: '123456',
          newPassword: 'NewPassword123!',
        })
        .expect(401);

      expect(response.body.message).toContain('Invalid or expired reset code');

      // Cleanup
      await redis.del('reset-password:ghost@example.com');
    });
  });

  describe('Social Login Protection', () => {
    it('should prevent password reset for GitHub accounts', async () => {
      // Create GitHub user
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
        .post('/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(400);

      expect(response.body.message).toContain('social login');
      expect(mockEmailService.sendResetPasswordEmail).not.toHaveBeenCalled();

      // Cleanup
      await prisma.user.delete({ where: { id: githubUser.id } });
    });

    it('should prevent password reset for Google accounts', async () => {
      // Create Google user
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
        .post('/auth/reset-password/request')
        .send({ email: testUser.email })
        .expect(400);

      expect(response.body.message).toContain('social login');

      // Cleanup
      await prisma.user.delete({ where: { id: googleUser.id } });
    });
  });

  describe('OTP Generation and Storage', () => {
    it('should generate 6-digit OTP', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);
      expect(resetOtp).toMatch(/^\d{6}$/);
      expect(resetOtp!.length).toBe(6);
    });

    it('should store OTP with 10-minute TTL', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/auth/reset-password/request')
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
        .post('/auth/reset-password/request')
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
        .post('/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);
      const newPassword = 'SecureNewPassword123!';

      await request(app.getHttpServer())
        .post('/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword,
        });

      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      // Verify password is hashed (not plaintext)
      expect(user!.password).not.toBe(newPassword);
      expect(user!.password).toContain('$argon2');

      // Verify password can be verified
      const isValid = await argon2.verify(user!.password!, newPassword);
      expect(isValid).toBe(true);
    });

    it('should not accept old password after reset', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      await request(app.getHttpServer())
        .post('/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'CompletelyNewPassword123!',
        });

      // Try to sign in with old password
      await request(app.getHttpServer())
        .post('/auth/signin')
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
        .post('/auth/reset-password/request')
        .send({ email: 'invalid-email' })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should validate new password strength', async () => {
      await createVerifiedUser();

      await request(app.getHttpServer())
        .post('/auth/reset-password/request')
        .send({ email: testUser.email });

      const resetOtp = await redis.get(`reset-password:${testUser.email}`);

      const response = await request(app.getHttpServer())
        .post('/auth/reset-password/confirm')
        .send({
          email: testUser.email,
          otp: resetOtp,
          newPassword: 'weak',
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });
  });
});
