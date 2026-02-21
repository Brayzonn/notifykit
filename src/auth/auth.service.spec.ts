import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { EmailService } from '@/email/email.service';
import {
  createMockUser,
  createMockCustomer,
  createMockRefreshToken,
} from '../../test/helpers/mock-factories';
import {
  createMockPrismaService,
  createMockRedisService,
  createMockJwtService,
  createMockConfigService,
  createMockEmailService,
} from '../../test/helpers/test-utils';
import { AuthProvider } from '@prisma/client';
import * as argon2 from 'argon2';

// Mock argon2
jest.mock('argon2');
const mockedArgon2 = argon2 as jest.Mocked<typeof argon2>;

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedisService>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let emailService: ReturnType<typeof createMockEmailService>;
  let configService: ReturnType<typeof createMockConfigService>;

  beforeEach(async () => {
    const mockPrisma = createMockPrismaService();
    const mockRedis = createMockRedisService();
    const mockJwt = createMockJwtService();
    const mockConfig = createMockConfigService();
    const mockEmail = createMockEmailService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
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
    configService = mockConfig;
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

      expect(jwtService.sign).toHaveBeenCalledTimes(2); // access + refresh
      expect(result.tokens.accessToken).toContain('mock.jwt.token');
      expect(result.tokens.refreshToken).toContain('mock.jwt.token');
    });

    it('should enforce 5-session limit by deleting oldest tokens', async () => {
      const mockUser = createMockUser();
      mockedArgon2.verify.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.count.mockResolvedValue(5); // Already at limit
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
        expect.stringMatching(/^\d{6}$/), // 6 digits
        600, // 10 minutes
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

    it('should validate OTP from Redis', async () => {
      const mockUser = createMockUser();
      redis.get.mockResolvedValue(otp);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.hash.mockResolvedValue('hashed_new_password');
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      await service.confirmPasswordReset(email, otp, newPassword);

      expect(redis.get).toHaveBeenCalledWith(`reset-password:${email}`);
    });

    it('should hash new password with argon2', async () => {
      const mockUser = createMockUser();
      redis.get.mockResolvedValue(otp);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.hash.mockResolvedValue('hashed_new_password');
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      await service.confirmPasswordReset(email, otp, newPassword);

      expect(mockedArgon2.hash).toHaveBeenCalledWith(newPassword);
    });

    it('should update password in database', async () => {
      const mockUser = createMockUser();
      redis.get.mockResolvedValue(otp);
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
      redis.get.mockResolvedValue(otp);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.hash.mockResolvedValue('hashed_new_password');
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 });

      await service.confirmPasswordReset(email, otp, newPassword);

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
      });
    });

    it('should delete OTP from Redis after success', async () => {
      const mockUser = createMockUser();
      redis.get.mockResolvedValue(otp);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      mockedArgon2.hash.mockResolvedValue('hashed_new_password');
      prisma.user.update.mockResolvedValue(mockUser);
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      await service.confirmPasswordReset(email, otp, newPassword);

      expect(redis.del).toHaveBeenCalledWith(`reset-password:${email}`);
    });

    it('should throw UnauthorizedException for invalid OTP', async () => {
      redis.get.mockResolvedValue('999999');

      await expect(
        service.confirmPasswordReset(email, otp, newPassword),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.confirmPasswordReset(email, otp, newPassword),
      ).rejects.toThrow('Invalid or expired reset code');
    });

    it('should throw UnauthorizedException for expired OTP', async () => {
      redis.get.mockResolvedValue(null);

      await expect(
        service.confirmPasswordReset(email, otp, newPassword),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      redis.get.mockResolvedValue(otp);
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

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { token: refreshToken },
        include: { user: true },
      });
    });

    it('should return only new access token if > 24hrs remaining', async () => {
      const futureExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
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
      const soonExpiry = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours
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
        expiresAt: new Date(Date.now() - 1000), // Already expired
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

  describe('logout', () => {
    const refreshToken = 'valid.refresh.token';

    it('should delete refresh token from database', async () => {
      prisma.refreshToken.delete.mockResolvedValue(
        createMockRefreshToken('user-123'),
      );

      await service.logout(refreshToken);

      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { token: refreshToken },
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
