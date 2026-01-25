import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import {
  SignupDto,
  SigninDto,
  VerifyOtpDto,
  ResendOtpDto,
  JwtPayload,
} from '@/auth/dto/auth.dto';
import { User, AuthProvider, Customer, CustomerPlan } from '@prisma/client';
import {
  AuthResponse,
  AuthTokens,
  GithubProfile,
} from '@/auth/interfaces/auth.interface';
import { RedisService } from '@/redis/redis.service';
import { EmailService } from '@/email/email.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly MAX_ACTIVE_SESSIONS = 5;
  private readonly JWT_REFRESH_SECRET: string;
  private readonly JWT_REFRESH_EXPIRES_IN: string;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redis: RedisService,
    private emailService: EmailService,
  ) {
    this.JWT_REFRESH_SECRET = this.configService.get('JWT_REFRESH_SECRET', '');
    this.JWT_REFRESH_EXPIRES_IN = this.configService.get(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
  }

  /**
   * Sign In with GitHub OAuth
   */
  async validateGithubUser(profile: GithubProfile): Promise<AuthResponse> {
    if (!profile.email) {
      throw new UnauthorizedException(
        'No public email found. Please make your email public on GitHub.',
      );
    }

    let user = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });

    let isNewUser = false;
    let apiKey: string | undefined;

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name,
          provider: AuthProvider.GITHUB,
          providerId: profile.githubId,
          emailVerified: true,
          ...(profile.avatar && { avatar: profile.avatar }),
        },
      });

      isNewUser = true;
    } else if (user.provider === AuthProvider.EMAIL) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          provider: AuthProvider.GITHUB,
          providerId: profile.githubId,
          ...(profile.avatar && { avatar: profile.avatar }),
          emailVerified: true,
        },
      });
    }

    if (isNewUser) {
      const { apiKey: newApiKey } = await this.createCustomerForUser(user);
      apiKey = newApiKey;
    }

    const tokens = await this.generateTokens(user);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      user: this.sanitizeUser(user),
      tokens,
      ...(apiKey && { apiKey }),
    };
  }

  /**
   * Signup - Store signup dataand send OTP
   */
  async signup(signupDto: SignupDto): Promise<{ email: string }> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: signupDto.email },
    });

    if (existingUser && existingUser.emailVerified) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await argon2.hash(signupDto.password);

    const signupData = {
      email: signupDto.email,
      password: hashedPassword,
      name: signupDto.name,
      company: signupDto.company,
    };

    await this.redis.set(
      `signup:${signupDto.email}`,
      JSON.stringify(signupData),
      600, // 10 minutes
    );

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`otp:${signupDto.email}`, otp, 600);

    try {
      await this.emailService.sendOtpEmail({
        email: signupDto.email,
        otp,
        expiresInMinutes: 10,
      });
    } catch (error) {
      await this.redis.del(`signup:${signupDto.email}`);
      await this.redis.del(`otp:${signupDto.email}`);
      throw new BadRequestException('Failed to send verification email');
    }

    this.logger.log(`Signup initiated for ${signupDto.email}: OTP ${otp}`);

    return { email: signupDto.email };
  }

  /**
   * Signin - Authenticate user
   */
  async signin(signinDto: SigninDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: signinDto.email },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException('Please verify your email.');
    }

    const isPasswordValid = await argon2.verify(
      user.password,
      signinDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const activeTokens = await this.prisma.refreshToken.count({
      where: {
        userId: user.id,
        expiresAt: { gt: new Date() },
      },
    });

    if (activeTokens >= this.MAX_ACTIVE_SESSIONS) {
      const oldestToken = await this.prisma.refreshToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });

      if (oldestToken) {
        await this.prisma.refreshToken.delete({
          where: { id: oldestToken.id },
        });
      }
    }

    const tokens = await this.generateTokens(user);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  /**
   * Verify OTP - Create user and complete signup process
   */
  async verifyOtp(verifyOtpDto: VerifyOtpDto): Promise<AuthResponse> {
    const storedOtp = await this.redis.get(`otp:${verifyOtpDto.email}`);

    if (!storedOtp) {
      throw new UnauthorizedException('OTP expired. Please sign up again.');
    }

    if (storedOtp !== verifyOtpDto.otp) {
      throw new UnauthorizedException('Invalid OTP');
    }

    const signupDataStr = await this.redis.get(`signup:${verifyOtpDto.email}`);

    if (!signupDataStr) {
      throw new UnauthorizedException(
        'Signup session expired. Please sign up again.',
      );
    }

    const signupData = JSON.parse(signupDataStr);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: verifyOtpDto.email },
    });

    let user: User;
    let isNewUser = false;
    let apiKey: string | undefined;

    if (existingUser) {
      user = await this.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          password: signupData.password,
          name: signupData.name,
          company: signupData.company,
          emailVerified: true,
        },
      });
    } else {
      user = await this.prisma.user.create({
        data: {
          email: signupData.email,
          password: signupData.password,
          name: signupData.name,
          company: signupData.company,
          provider: AuthProvider.EMAIL,
          emailVerified: true,
        },
      });
      isNewUser = true;
    }

    if (isNewUser) {
      const { apiKey: newApiKey } = await this.createCustomerForUser(user);
      apiKey = newApiKey;
    }

    await this.redis.del(`otp:${verifyOtpDto.email}`);
    await this.redis.del(`signup:${verifyOtpDto.email}`);

    const tokens = await this.generateTokens(user);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      user: this.sanitizeUser(user),
      tokens,
      ...(apiKey && { apiKey }),
    };
  }

  /**
   * Resend OTP
   */
  async resendOtp(resendOtpDto: ResendOtpDto): Promise<{ expiresIn: number }> {
    const signupDataStr = await this.redis.get(`signup:${resendOtpDto.email}`);

    if (!signupDataStr) {
      throw new UnauthorizedException(
        'Signup session expired. Please sign up again.',
      );
    }

    const resendKey = `otp-resend:${resendOtpDto.email}`;
    const resendCount = await this.redis.get(resendKey);

    if (resendCount && parseInt(resendCount) >= 3) {
      throw new BadRequestException(
        'Too many resend requests. Try again in 10 minutes.',
      );
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`otp:${resendOtpDto.email}`, otp, 600);

    const currentCount = await this.redis.getClient().incr(resendKey);
    if (currentCount === 1) {
      await this.redis.getClient().expire(resendKey, 600);
    }

    await this.emailService.sendOtpEmail({
      email: resendOtpDto.email,
      otp,
      expiresInMinutes: 10,
    });

    this.logger.log(`Resent OTP for ${resendOtpDto.email}: ${otp}`);

    return { expiresIn: 600 };
  }

  /**
   * Refresh access token
   */
  async refreshToken(token: string): Promise<AuthResponse> {
    this.verifyRefreshToken(token);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    if (storedToken.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    const newTokens = await this.generateTokens(storedToken.user);

    await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });

    await this.prisma.refreshToken.create({
      data: {
        userId: storedToken.user.id,
        token: newTokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      user: this.sanitizeUser(storedToken.user),
      tokens: newTokens,
    };
  }

  /**
   * Logout - Invalidate refresh token
   */
  async logout(token: string): Promise<void> {
    try {
      await this.prisma.refreshToken.delete({ where: { token } });
      this.logger.log('User logged out successfully');
    } catch (error) {
      this.logger.warn('Refresh token not found during logout');
    }
  }

  /**
   * ══════════════════════════════════════════════════════════════════════
   * HELPERS
   * ══════════════════════════════════════════════════════════════════════
   */

  /**
   * Create customer record for new user
   */
  private async createCustomerForUser(
    user: User,
  ): Promise<{ customer: Customer; apiKey: string }> {
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { userId: user.id },
    });

    if (existingCustomer) {
      return { customer: existingCustomer, apiKey: existingCustomer.apiKey };
    }

    const apiKey = this.generateApiKey();
    const apiKeyHash = await argon2.hash(apiKey);

    const customer = await this.prisma.customer.create({
      data: {
        userId: user.id,
        email: user.email,
        apiKey,
        apiKeyHash,
        plan: CustomerPlan.FREE,
        monthlyLimit: 1000,
        usageCount: 0,
        usageResetAt: new Date(),
        isActive: true,
      },
    });

    this.logger.log(`Customer created for user: ${user.id}`);

    return { customer, apiKey };
  }

  /**
   * Generate API key
   */
  private generateApiKey(): string {
    const randomBytes = crypto.randomBytes(32);
    return `nh_${randomBytes.toString('hex')}`;
  }

  /**
   * Verify refresh tokens
   */
  private verifyRefreshToken(token: string): JwtPayload {
    try {
      return this.jwtService.verify(token, {
        secret: this.JWT_REFRESH_SECRET,
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /**
   * Generate access and refresh tokens
   */

  private async generateTokens(user: User): Promise<AuthTokens> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    return { accessToken, refreshToken };
  }

  /**
   * Remove sensitive data from user object
   */
  private sanitizeUser(user: User) {
    const { password, providerId, ...sanitizedUser } = user;
    return sanitizedUser;
  }
}
