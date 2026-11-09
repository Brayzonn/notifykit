import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { SessionService } from './services/session.service';
import { OtpService } from './services/otp.service';
import { UserProvisioningService } from './services/user-provisioning.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { EmailService } from '@/platform-email/email.service';
import {
  createMockUser,
  createMockRefreshToken,
} from '../../test/helpers/mock-factories';
import {
  createMockPrismaService,
  createMockRedisService,
  createMockJwtService,
  createMockConfigService,
  createMockEmailService,
} from '../../test/helpers/test-utils';
import { AuthProvider } from '@/generated/prisma/client';
import * as argon2 from 'argon2';

jest.mock('argon2');
const mockedArgon2 = argon2 as jest.Mocked<typeof argon2>;

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedisService>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let emailService: ReturnType<typeof createMockEmailService>;

  beforeEach(async () => {
    const mockPrisma = createMockPrismaService();
    const mockRedis = createMockRedisService();
    const mockJwt = createMockJwtService();
    const mockConfig = createMockConfigService();
    const mockEmail = createMockEmailService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        SessionService,
        OtpService,
        UserProvisioningService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmailService, useValue: mockEmail },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = mockPrisma;
    redis = mockRedis;
    jwtService = mockJwt;
    emailService = mockEmail;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signin', () => {
    const signinDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should successfully authenticate user with valid credentials', async () => {
      const mockUser = createMockUser();
      mockedArgon2.verify.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.count.mockResolvedValue(0);
      prisma.refreshToken.create.mockResolvedValue(
        createMockRefreshToken(mockUser.id),
      );

      const result = await service.signin(signinDto);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(result.user.email).toBe(mockUser.email);
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: signinDto.email },
      });
      expect(argon2.verify).toHaveBeenCalledWith(
        mockUser.password,
        signinDto.password,
      );
    });

    it('should verify password using argon2.verify', async () => {
      const mockUser = createMockUser();
      mockedArgon2.verify.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.count.mockResolvedValue(0);
      prisma.refreshToken.create.mockResolvedValue(
        createMockRefreshToken(mockUser.id),
      );

      await service.signin(signinDto);

      expect(mockedArgon2.verify).toHaveBeenCalledWith(
        mockUser.password,
        signinDto.password,
      );
    });

    it('should generate access and refresh tokens', async () => {
      const mockUser = createMockUser();
      mockedArgon2.verify.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.count.mockResolvedValue(0);
      prisma.refreshToken.create.mockResolvedValue(
        createMockRefreshToken(mockUser.id),
      );

      const result = await service.signin(signinDto);

      expect(jwtService.sign).toHaveBeenCalledTimes(2);
      expect(result.tokens.accessToken).toContain('mock.jwt.token');
      expect(result.tokens.refreshToken).toContain('mock.jwt.token');
    });

    it('should enforce 5-session limit by deleting oldest tokens', async () => {
      const mockUser = createMockUser();
      mockedArgon2.verify.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.count.mockResolvedValue(5);
      prisma.refreshToken.findMany.mockResolvedValue([
        { id: 'token-1' },
        { id: 'token-2' },
      ]);
      prisma.refreshToken.create.mockResolvedValue(
        createMockRefreshToken(mockUser.id),
      );

      await service.signin(signinDto);

      expect(prisma.refreshToken.count).toHaveBeenCalled();
      expect(prisma.refreshToken.findMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        orderBy: { createdAt: 'asc' },
        take: expect.any(Number),
        select: { id: true },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for invalid email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.signin(signinDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.signin(signinDto)).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const mockUser = createMockUser();
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.verify.mockResolvedValue(false);

      await expect(service.signin(signinDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.signin(signinDto)).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('should throw UnauthorizedException if email not verified', async () => {
      const mockUser = createMockUser({ emailVerified: false });
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.signin(signinDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.signin(signinDto)).rejects.toThrow(
        'Please verify your email.',
      );
    });

    it('should throw UnauthorizedException if account deleted', async () => {
      const mockUser = createMockUser({ deletedAt: new Date() });
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.signin(signinDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.signin(signinDto)).rejects.toThrow(
        'Account has been deleted',
      );
    });
  });

  describe('requestPasswordReset', () => {
    const email = 'test@example.com';

    it('should generate 6-digit OTP and store in Redis with 10min TTL', async () => {
      const mockUser = createMockUser();
      prisma.user.findUnique.mockResolvedValue(mockUser);
      emailService.sendResetPasswordEmail.mockResolvedValue(undefined);

      await service.requestPasswordReset(email);

      expect(redis.set).toHaveBeenCalledWith(
        `reset-password:${email}`,
        expect.stringMatching(/^\d{6}$/),
        600,
      );
    });

    it('should send reset email via EmailService', async () => {
      const mockUser = createMockUser();
      prisma.user.findUnique.mockResolvedValue(mockUser);
      emailService.sendResetPasswordEmail.mockResolvedValue(undefined);

      await service.requestPasswordReset(email);

      expect(emailService.sendResetPasswordEmail).toHaveBeenCalledWith({
        email,
        otp: expect.stringMatching(/^\d{6}$/),
        expiresInMinutes: 10,
      });
    });

    it('should return generic message for non-existent user (security)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.requestPasswordReset(email);

      expect(result.message).toBe(
        'If this email exists, a reset code has been sent',
      );
      expect(redis.set).not.toHaveBeenCalled();
      expect(emailService.sendResetPasswordEmail).not.toHaveBeenCalled();
    });

    it('should cleanup Redis if email send fails', async () => {
      const mockUser = createMockUser();
      prisma.user.findUnique.mockResolvedValue(mockUser);
      emailService.sendResetPasswordEmail.mockRejectedValue(
        new Error('Email send failed'),
      );

      await expect(service.requestPasswordReset(email)).rejects.toThrow(
        BadRequestException,
      );
      expect(redis.del).toHaveBeenCalledWith(`reset-password:${email}`);
    });

    it('should throw BadRequestException for social login accounts', async () => {
      const mockUser = createMockUser({ provider: AuthProvider.GITHUB });
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.requestPasswordReset(email)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.requestPasswordReset(email)).rejects.toThrow(
        'This account uses social login',
      );
    });
  });

  describe('confirmPasswordReset', () => {
    const email = 'test@example.com';
    const otp = '123456';
    const newPassword = 'newPassword123';

    it('should check the OTP against the reset-password key', async () => {
      const mockUser = createMockUser();
      redis.runScript.mockResolvedValue('valid');
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.hash.mockResolvedValue('hashed_new_password');
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      await service.confirmPasswordReset(email, otp, newPassword);

      expect(redis.runScript).toHaveBeenCalledWith(
        expect.any(String),
        [`reset-password:${email}`, `otp-attempts:reset-password:${email}`],
        [otp, 5, 600],
      );
    });

    it('should hash new password with argon2', async () => {
      const mockUser = createMockUser();
      redis.runScript.mockResolvedValue('valid');
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.hash.mockResolvedValue('hashed_new_password');
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      await service.confirmPasswordReset(email, otp, newPassword);

      expect(mockedArgon2.hash).toHaveBeenCalledWith(newPassword);
    });

    it('should update password in database', async () => {
      const mockUser = createMockUser();
      redis.runScript.mockResolvedValue('valid');
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.hash.mockResolvedValue('hashed_new_password');
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      await service.confirmPasswordReset(email, otp, newPassword);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { password: 'hashed_new_password' },
      });
    });

    it('should delete ALL refresh tokens (invalidate all sessions)', async () => {
      const mockUser = createMockUser();
      redis.runScript.mockResolvedValue('valid');
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.hash.mockResolvedValue('hashed_new_password');
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 });

      await service.confirmPasswordReset(email, otp, newPassword);

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
      });
    });

    it('should use up the OTP before changing the password', async () => {
      const mockUser = createMockUser();
      redis.runScript.mockResolvedValue('valid');
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.hash.mockResolvedValue('hashed_new_password');
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      await service.confirmPasswordReset(email, otp, newPassword);

      expect(redis.runScript.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.user.update.mock.invocationCallOrder[0],
      );
    });

    it('should throw UnauthorizedException for invalid OTP', async () => {
      redis.runScript.mockResolvedValue('mismatch');

      await expect(
        service.confirmPasswordReset(email, otp, newPassword),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.confirmPasswordReset(email, otp, newPassword),
      ).rejects.toThrow('Invalid or expired reset code');
    });

    it('should throw UnauthorizedException for expired OTP', async () => {
      redis.runScript.mockResolvedValue('missing');

      await expect(
        service.confirmPasswordReset(email, otp, newPassword),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      redis.runScript.mockResolvedValue('valid');
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmPasswordReset(email, otp, newPassword),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshToken', () => {
    const refreshToken = 'valid.refresh.token';
    const mockUser = createMockUser();
    const mockStoredToken = {
      ...createMockRefreshToken(mockUser.id),
      user: mockUser,
    };

    it('should verify JWT token with refresh secret', async () => {
      jwtService.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
      prisma.refreshToken.findUnique.mockResolvedValue(mockStoredToken);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.count.mockResolvedValue(0);
      prisma.refreshToken.create.mockResolvedValue(mockStoredToken);

      await service.refreshToken(refreshToken);

      expect(jwtService.verify).toHaveBeenCalledWith(refreshToken, {
        secret: 'test-refresh-secret',
      });
    });

    it('should validate token exists in database', async () => {
      jwtService.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
      prisma.refreshToken.findUnique.mockResolvedValue(mockStoredToken);

      await service.refreshToken(refreshToken);

      const expectedHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { token: expectedHash },
        include: { user: true },
      });
    });

    it('should return only new access token if > 24hrs remaining', async () => {
      const futureExpiry = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
      jwtService.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...mockStoredToken,
        expiresAt: futureExpiry,
      });

      const result = await service.refreshToken(refreshToken);

      expect(result.tokens).toHaveProperty('accessToken');
      expect(result.tokens).not.toHaveProperty('refreshToken');
    });

    it('should rotate both tokens if < 24hrs remaining', async () => {
      const soonExpiry = new Date(Date.now() + 12 * 60 * 60 * 1000);
      jwtService.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...mockStoredToken,
        expiresAt: soonExpiry,
      });
      prisma.refreshToken.delete.mockResolvedValue(mockStoredToken);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.count.mockResolvedValue(0);
      prisma.refreshToken.create.mockResolvedValue(mockStoredToken);

      const result = await service.refreshToken(refreshToken);

      expect(result.tokens).toHaveProperty('accessToken');
      expect(result.tokens).toHaveProperty('refreshToken');
    });

    it('should delete old refresh token on rotation', async () => {
      const soonExpiry = new Date(Date.now() + 12 * 60 * 60 * 1000);
      jwtService.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...mockStoredToken,
        expiresAt: soonExpiry,
      });
      prisma.refreshToken.delete.mockResolvedValue(mockStoredToken);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.count.mockResolvedValue(0);
      prisma.refreshToken.create.mockResolvedValue(mockStoredToken);

      await service.refreshToken(refreshToken);

      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: mockStoredToken.id },
      });
    });

    it('should throw UnauthorizedException for invalid JWT', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if token not in DB', async () => {
      jwtService.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if token expired', async () => {
      const expiredToken = {
        ...mockStoredToken,
        expiresAt: new Date(Date.now() - 1000),
      };
      jwtService.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
      prisma.refreshToken.findUnique.mockResolvedValue(expiredToken);

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if account deleted', async () => {
      const deletedUser = createMockUser({ deletedAt: new Date() });
      jwtService.verify.mockReturnValue({
        sub: deletedUser.id,
        email: deletedUser.email,
        role: deletedUser.role,
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...mockStoredToken,
        user: deletedUser,
      });

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('OTP wrong-guess cap', () => {
    const email = 'user@example.com';

    it('tells the user to wait once signup OTP is locked', async () => {
      redis.runScript.mockResolvedValue('locked');

      await expect(service.verifyOtp({ email, otp: '222222' })).rejects.toThrow(
        'Too many incorrect attempts. Please try again in a few minutes.',
      );
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('keeps the generic reset message once a reset code is locked', async () => {
      redis.runScript.mockResolvedValue('locked');

      await expect(
        service.confirmPasswordReset(email, '222222', 'NewPassword123!'),
      ).rejects.toThrow('Invalid or expired reset code');
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    const email = 'new@example.com';

    it('creates the user and reuses its customer without looking it up again', async () => {
      const customer = { id: 'customer-1' };
      const user = { ...createMockUser({ email }), customer };
      redis.runScript.mockResolvedValue('valid');
      redis.get.mockResolvedValue(
        JSON.stringify({ email, password: 'hashed', name: 'New User' }),
      );
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(user);
      prisma.refreshToken.count.mockResolvedValue(0);

      await service.verifyOtp({ email, otp: '123456' });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ include: { customer: true } }),
      );
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(redis.del).toHaveBeenCalledWith(`signup:${email}`);
    });
  });

  describe('resendOtp', () => {
    const email = 'new@example.com';

    beforeEach(() => {
      redis.get.mockImplementation((key: string) =>
        Promise.resolve(
          key === `signup:${email}` ? JSON.stringify({ email }) : null,
        ),
      );
    });

    it('reserves the resend before sending, then stores the code', async () => {
      await service.resendOtp({ email });

      const reserveOrder = redis.incrementWithTtl.mock.invocationCallOrder[0];
      const sendOrder = emailService.sendOtpEmail.mock.invocationCallOrder[0];
      const storeOrder = redis.set.mock.invocationCallOrder[0];

      expect(redis.incrementWithTtl).toHaveBeenCalledWith(
        `otp-resend:${email}`,
        600,
      );
      expect(redis.set).toHaveBeenCalledWith(
        `otp:${email}`,
        expect.stringMatching(/^\d{6}$/),
        600,
      );
      expect(reserveOrder).toBeLessThan(sendOrder);
      expect(sendOrder).toBeLessThan(storeOrder);
    });

    it('extends the pending signup along with the new code', async () => {
      await service.resendOtp({ email });

      expect(redis.set).toHaveBeenCalledWith(
        `signup:${email}`,
        JSON.stringify({ email }),
        600,
      );
    });

    it('rejects without sending once the resend limit is reached', async () => {
      redis.incrementWithTtl.mockResolvedValue(4);

      await expect(service.resendOtp({ email })).rejects.toThrow(
        BadRequestException,
      );
      expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('keeps the old code and gives back the resend when sending fails', async () => {
      emailService.sendOtpEmail.mockRejectedValue(new Error('provider down'));

      await expect(service.resendOtp({ email })).rejects.toThrow(
        new BadRequestException('Failed to send verification email'),
      );
      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
      expect(redis.runScript).toHaveBeenCalledWith(
        expect.stringContaining('DECR'),
        [`otp-resend:${email}`],
        [],
      );
    });
  });

  describe('OTP logging', () => {
    const email = 'new@example.com';

    it('does not log the OTP on signup', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      mockedArgon2.hash.mockResolvedValue('hashed');
      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.signup({
        email,
        password: 'Password123!',
        name: 'New User',
      } as any);

      const otp = redis.set.mock.calls.find(
        ([key]) => key === `otp:${email}`,
      )![1];
      for (const [message] of loggerSpy.mock.calls) {
        expect(String(message)).not.toContain(otp);
      }
    });

    it('does not log the OTP on resend', async () => {
      redis.get.mockImplementation((key: string) =>
        Promise.resolve(
          key === `signup:${email}` ? JSON.stringify({ email }) : null,
        ),
      );
      redis.getClient.mockReturnValue({
        incr: jest.fn().mockResolvedValue(1),
        expire: jest.fn(),
      });
      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.resendOtp({ email });

      const otp = redis.set.mock.calls.find(
        ([key]) => key === `otp:${email}`,
      )![1];
      for (const [message] of loggerSpy.mock.calls) {
        expect(String(message)).not.toContain(otp);
      }
    });
  });

  describe('logout', () => {
    const refreshToken = 'valid.refresh.token';

    it('should delete refresh token from database', async () => {
      prisma.refreshToken.delete.mockResolvedValue(
        createMockRefreshToken('user-123'),
      );

      await service.logout(refreshToken);

      const expectedHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { token: expectedHash },
      });
    });

    it('should be idempotent (no error if token does not exist)', async () => {
      prisma.refreshToken.delete.mockRejectedValue(new Error('Not found'));

      const result = await service.logout(refreshToken);

      expect(result.message).toBe('Logged out successfully');
    });

    it('should log successful logout', async () => {
      prisma.refreshToken.delete.mockResolvedValue(
        createMockRefreshToken('user-123'),
      );

      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.logout(refreshToken);

      expect(loggerSpy).toHaveBeenCalledWith('User logged out successfully');
    });
  });
});
