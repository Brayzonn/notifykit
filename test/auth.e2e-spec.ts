import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { EmailService } from '../src/email/email.service';

describe('Auth Flow (e2e)', () => {
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
    email: `test-${Date.now()}@example.com`,
    password: 'Test123!@#',
    name: 'Test User',
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
    await prisma.refreshToken.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.user.deleteMany({ where: { email: testUser.email } });

    await redis.del(`otp:${testUser.email}`);
    await redis.del(`signup:${testUser.email}`);
    await redis.del(`otp-resend:${testUser.email}`);
  });

  describe('Complete Signup → Verify → Signin Flow', () => {
    it('should complete the full authentication flow', async () => {
      // Step 1: Signup
      const signupResponse = await request(app.getHttpServer())
        .post('/auth/signup')
        .send(testUser)
        .expect(201);

      expect(signupResponse.body).toHaveProperty('email', testUser.email);
      expect(mockEmailService.sendOtpEmail).toHaveBeenCalled();

      // Extract OTP from Redis
      const otp = await redis.get(`otp:${testUser.email}`);
      expect(otp).toBeTruthy();
      expect(otp).toMatch(/^\d{6}$/);

      // Step 2: Verify OTP
      const verifyResponse = await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({
          email: testUser.email,
          otp,
        })
        .expect(200);

      expect(verifyResponse.body).toHaveProperty('user');
      expect(verifyResponse.body).toHaveProperty('accessToken');
      expect(verifyResponse.body.user.email).toBe(testUser.email);
      expect(verifyResponse.body.user.emailVerified).toBe(true);

      // Check user created in database
      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });
      expect(user).toBeTruthy();
      expect(user?.emailVerified).toBe(true);

      // Check customer created
      const customer = await prisma.customer.findUnique({
        where: { userId: user!.id },
      });
      expect(customer).toBeTruthy();
      expect(customer?.plan).toBe('FREE');
      expect(customer?.monthlyLimit).toBe(1000);

      // Step 3: Sign in
      const signinResponse = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      expect(signinResponse.body).toHaveProperty('user');
      expect(signinResponse.body).toHaveProperty('accessToken');
      expect(signinResponse.headers['set-cookie']).toBeDefined();
    });

    it('should store OTP in Redis with 10-minute TTL', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send(testUser)
        .expect(201);

      const otp = await redis.get(`otp:${testUser.email}`);
      expect(otp).toBeTruthy();

      // Check TTL (should be close to 600 seconds)
      const ttl = await redis.getClient().ttl(`otp:${testUser.email}`);
      expect(ttl).toBeGreaterThan(590);
      expect(ttl).toBeLessThanOrEqual(600);
    });

    it('should reject signup with existing verified email', async () => {
      // First signup and verify
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send(testUser)
        .expect(201);

      const otp = await redis.get(`otp:${testUser.email}`);

      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: testUser.email, otp })
        .expect(200);

      // Try to signup again with same email
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send(testUser)
        .expect(409);
    });
  });

  describe('Refresh Token Flow', () => {
    let accessToken: string;
    let refreshTokenCookie: string;

    beforeEach(async () => {
      // Setup: Create verified user
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      const otp = await redis.get(`otp:${testUser.email}`);

      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: testUser.email, otp });

      const signinResponse = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      accessToken = signinResponse.body.accessToken;
      refreshTokenCookie = signinResponse.headers['set-cookie'][0];
    });

    it('should refresh access token with valid refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh-token')
        .set('Cookie', refreshTokenCookie)
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.accessToken).toBeDefined();
      expect(response.body.accessToken).not.toBe(accessToken);
    });

    it('should return new accessToken if not expiring soon', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh-token')
        .set('Cookie', refreshTokenCookie)
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      // If not rotating, should not set new cookie
      // (rotation happens only if < 24hrs remaining)
    });

    it('should throw error for missing refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh-token')
        .expect(401);

      expect(response.body.message).toContain('Refresh token not found');
    });
  });

  describe('Logout Flow', () => {
    let accessToken: string;
    let refreshTokenCookie: string;

    beforeEach(async () => {
      // Setup: Create verified user and sign in
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      const otp = await redis.get(`otp:${testUser.email}`);

      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: testUser.email, otp });

      const signinResponse = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      accessToken = signinResponse.body.accessToken;
      refreshTokenCookie = signinResponse.headers['set-cookie'][0];
    });

    it('should logout and invalidate refresh token', async () => {
      const logoutResponse = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', refreshTokenCookie)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(logoutResponse.body.message).toBe('Logged out successfully');

      // Check refresh token deleted from database
      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      const tokens = await prisma.refreshToken.findMany({
        where: { userId: user!.id },
      });

      expect(tokens).toHaveLength(0);
    });

    it('should fail to refresh token after logout', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', refreshTokenCookie)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Try to refresh with logged out token
      await request(app.getHttpServer())
        .post('/auth/refresh-token')
        .set('Cookie', refreshTokenCookie)
        .expect(401);
    });
  });

  describe('Session Limit Enforcement', () => {
    it('should enforce 5-session limit', async () => {
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      const otp = await redis.get(`otp:${testUser.email}`);

      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: testUser.email, otp });

      // Sign in 6 times
      const sessions: string[] = [];
      for (let i = 0; i < 6; i++) {
        const response = await request(app.getHttpServer())
          .post('/auth/signin')
          .send({
            email: testUser.email,
            password: testUser.password,
          });

        sessions.push(response.headers['set-cookie'][0]);

        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const user = await prisma.user.findUnique({
        where: { email: testUser.email },
      });

      const tokens = await prisma.refreshToken.findMany({
        where: { userId: user!.id },
        orderBy: { createdAt: 'desc' },
      });

      expect(tokens).toHaveLength(5);
    });
  });

  describe('OTP Resend Flow', () => {
    it('should resend OTP successfully', async () => {
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      const firstOtp = await redis.get(`otp:${testUser.email}`);

      const resendResponse = await request(app.getHttpServer())
        .post('/auth/resend-otp')
        .send({ email: testUser.email })
        .expect(200);

      expect(resendResponse.body).toHaveProperty('expiresIn', 600);
      expect(mockEmailService.sendOtpEmail).toHaveBeenCalledTimes(2);

      const newOtp = await redis.get(`otp:${testUser.email}`);
      expect(newOtp).toBeTruthy();
      expect(newOtp).not.toBe(firstOtp);
    });

    it('should track resend counter in Redis', async () => {
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      await request(app.getHttpServer())
        .post('/auth/resend-otp')
        .send({ email: testUser.email });

      const resendCount = await redis.get(`otp-resend:${testUser.email}`);
      expect(resendCount).toBe('1');
    });

    it('should limit resend attempts to 3', async () => {
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      // Resend 3 times
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/auth/resend-otp')
          .send({ email: testUser.email })
          .expect(200);
      }

      // 4th attempt should fail
      await request(app.getHttpServer())
        .post('/auth/resend-otp')
        .send({ email: testUser.email })
        .expect(400);
    });
  });

  describe('Validation', () => {
    it('should validate email format', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          ...testUser,
          email: 'invalid-email',
        })
        .expect(400);

      expect(response.body.message).toContain('email');
    });

    it('should validate password strength', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          ...testUser,
          password: 'weak',
        })
        .expect(400);

      expect(response.body.message).toContain('password');
    });

    it('should require all fields for signup', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          email: testUser.email,
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });
  });

  describe('Error Cases', () => {
    it('should return 401 for invalid OTP', async () => {
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({
          email: testUser.email,
          otp: '999999',
        })
        .expect(401);
    });

    it('should return 401 for invalid credentials on signin', async () => {
      // Create verified user
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      const otp = await redis.get(`otp:${testUser.email}`);

      await request(app.getHttpServer())
        .post('/auth/verify-otp')
        .send({ email: testUser.email, otp });

      // Try with wrong password
      await request(app.getHttpServer())
        .post('/auth/signin')
        .send({
          email: testUser.email,
          password: 'WrongPassword123!',
        })
        .expect(401);
    });

    it('should return 401 for unverified email on signin', async () => {
      await request(app.getHttpServer()).post('/auth/signup').send(testUser);

      // Try to signin without verifying OTP
      await request(app.getHttpServer())
        .post('/auth/signin')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(401);
    });
  });
});
