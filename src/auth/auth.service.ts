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
import {
  User,
  AuthProvider,
  Customer,
  CustomerPlan,
  SubscriptionStatus,
} from '@prisma/client';
import {
  AuthResponse,
  AuthTokens,
  GithubProfile,
  RefreshTokenResponse,
} from '@/auth/interfaces/auth.interface';
import { RedisService } from '@/redis/redis.service';
import { EmailService } from '@/email/email.service';
import { getPlanLimit } from '@/common/constants/plans.constants';

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

    if (user.deletedAt) {
      throw new UnauthorizedException(
        'Account has been deleted. Please contact support.',
      );
    }

    await this.createCustomerForUser(user);

    const tokens = await this.generateTokens(user);

    await this.createRefreshTokenWithLimit(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      tokens,
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

    if (user.deletedAt) {
      throw new UnauthorizedException('Account has been deleted');
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

    const tokens = await this.generateTokens(user);

    await this.createRefreshTokenWithLimit(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  /**
   * Request password reset - Generate OTP and send email
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.emailVerified || user.deletedAt) {
      return { message: 'If this email exists, a reset code has been sent' };
    }

    if (user.provider !== AuthProvider.EMAIL) {
      throw new BadRequestException(
        'This account uses social login. Please sign in with social login.',
      );
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`reset-password:${email}`, otp, 600); // 10 minutes

    try {
      await this.emailService.sendResetPasswordEmail({
        email,
        otp,
        expiresInMinutes: 10,
      });
    } catch (error) {
      await this.redis.del(`reset-password:${email}`);
      throw new BadRequestException('Failed to send reset email');
    }

    this.logger.log(`Password reset OTP sent to ${email}`);
    return { message: 'If this email exists, a reset code has been sent' };
  }

  /**
   * Confirm password reset - Verify OTP and update password
   */
  async confirmPasswordReset(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const storedOtp = await this.redis.get(`reset-password:${email}`);

    if (!storedOtp || storedOtp !== otp) {
      throw new UnauthorizedException('Invalid or expired reset code');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset code');
    }

    const hashedPassword = await argon2.hash(newPassword);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    await this.redis.del(`reset-password:${email}`);

    this.logger.log(`Password reset successful for ${email}`);
    return { message: 'Password reset successfully' };
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

    await this.createCustomerForUser(user);

    await this.redis.del(`otp:${verifyOtpDto.email}`);
    await this.redis.del(`signup:${verifyOtpDto.email}`);

    const tokens = await this.generateTokens(user);

    await this.createRefreshTokenWithLimit(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      tokens,
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
  async refreshToken(token: string): Promise<RefreshTokenResponse> {
    this.verifyRefreshToken(token);

    const storedToken = await this.validateStoredRefreshToken(token);
    const isExpiringSoon = this.isTokenExpiringSoon(storedToken.expiresAt);

    if (isExpiringSoon) {
      const newTokens = await this.rotateRefreshToken(storedToken);

      return {
        user: this.sanitizeUser(storedToken.user),
        tokens: newTokens,
      };
    }

    const { accessToken } = await this.generateTokens(storedToken.user);

    return {
      user: this.sanitizeUser(storedToken.user),
      tokens: { accessToken },
    };
  }

  /**
   * Logout - Invalidate refresh token
   */
  async logout(token: string): Promise<{ message: string }> {
    try {
      await this.prisma.refreshToken.delete({ where: { token } });
      this.logger.log('User logged out successfully');
      return { message: 'Logged out successfully' };
    } catch (error) {
      this.logger.warn('Refresh token not found during logout');
      return { message: 'Logged out successfully' };
    }
  }

  /**
   * ══════════════════════════════════════════════════════════════════════
   * HELPERS
   * ══════════════════════════════════════════════════════════════════════
   */

  /**
   * downgrade customer to free plan
   */
  async downgradeToFreePlan(
    customerId: string,
    reason: 'SUBSCRIPTION_EXPIRED' | 'PAYMENT_FAILED',
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { plan: true, email: true },
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    const originalPlan = customer.plan;
    const now = new Date();

    const resetDate = new Date(now);
    resetDate.setDate(resetDate.getDate() + 30);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        plan: CustomerPlan.FREE,
        monthlyLimit: getPlanLimit(CustomerPlan.FREE),
        usageCount: 0,
        usageResetAt: resetDate,
        billingCycleStartAt: now,
        previousPlan: originalPlan,
        downgradedAt: now,
        subscriptionStatus: SubscriptionStatus.EXPIRED,
      },
    });

    //do later-------send user downgrade email--------------------------------------

    this.logger.warn(
      `Customer ${customer.email} downgraded from ${originalPlan} to FREE. Next reset: ${resetDate.toISOString()}`,
    );
  }

  /**
   * Reset customer usage for new billing cycle
   */
  async resetMonthlyUsage(customerId: string): Promise<void> {
    const resetDate = new Date();
    resetDate.setDate(resetDate.getDate() + 30); // 30 days from now

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        usageCount: 0,
        usageResetAt: resetDate,
        billingCycleStartAt: new Date(),
      },
    });

    this.logger.log(
      `Reset usage for customer ${customerId}. Next reset: ${resetDate.toISOString()}`,
    );
  }

  /**
   * Get usage stats for a customer
   */
  async getUsageStats(customerId: string): Promise<{
    usage: number;
    limit: number;
    remaining: number;
    resetAt: Date;
    billingCycleStartAt: Date;
    percentageUsed: number;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        usageCount: true,
        monthlyLimit: true,
        usageResetAt: true,
        billingCycleStartAt: true,
      },
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    const remaining = Math.max(0, customer.monthlyLimit - customer.usageCount);
    const percentageUsed = (customer.usageCount / customer.monthlyLimit) * 100;

    return {
      usage: customer.usageCount,
      limit: customer.monthlyLimit,
      remaining,
      resetAt: customer.usageResetAt,
      billingCycleStartAt: customer.billingCycleStartAt,
      percentageUsed: Math.round(percentageUsed * 100) / 100,
    };
  }

  /**
   * Increment usage counter
   */
  async incrementUsage(customerId: string): Promise<void> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { usageCount: { increment: 1 } },
    });
  }

  /**
   * Validate and retrieve stored refresh token
   */
  private async validateStoredRefreshToken(token: string) {
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

    if (storedToken.user.deletedAt) {
      await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException('Account has been deleted');
    }

    return storedToken;
  }

  /**
   * Check if token is expiring soon (less than 1 day)
   */
  private isTokenExpiringSoon(expiresAt: Date): boolean {
    const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return expiresAt < oneDayFromNow;
  }

  /**
   * Rotate expiring refresh token and generate new tokens
   */
  private async rotateRefreshToken(storedToken: any): Promise<AuthTokens> {
    const newTokens = await this.generateTokens(storedToken.user);

    await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });

    await this.createRefreshTokenWithLimit(
      storedToken.user.id,
      newTokens.refreshToken,
    );

    return newTokens;
  }

  /**
   *  Create refresh token with session limit enforcement
   */
  private async createRefreshTokenWithLimit(
    userId: string,
    refreshToken: string,
  ): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        expiresAt: { lt: new Date() },
      },
    });

    const activeTokens = await this.prisma.refreshToken.count({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
    });

    const tokensToDelete =
      activeTokens >= this.MAX_ACTIVE_SESSIONS
        ? activeTokens - this.MAX_ACTIVE_SESSIONS + 1
        : 0;

    if (tokensToDelete > 0) {
      const oldestTokens = await this.prisma.refreshToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        take: tokensToDelete,
        select: { id: true },
      });

      await this.prisma.refreshToken.deleteMany({
        where: {
          id: { in: oldestTokens.map((t) => t.id) },
        },
      });

      this.logger.log(
        `Deleted ${tokensToDelete} oldest refresh token(s) for user: ${userId}`,
      );
    }

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
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
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    return { accessToken, refreshToken };
  }

  /**
   * Create customer record for new user
   */
  private async createCustomerForUser(
    user: User,
  ): Promise<{ customer: Customer }> {
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { userId: user.id },
    });

    if (existingCustomer) {
      return { customer: existingCustomer };
    }

    const customer = await this.prisma.customer.create({
      data: {
        userId: user.id,
        email: user.email,
        apiKey: '',
        apiKeyHash: '',
        plan: CustomerPlan.FREE,
        monthlyLimit: getPlanLimit(CustomerPlan.FREE),
        usageCount: 0,
        usageResetAt: new Date(),
        isActive: true,
      },
    });

    return { customer };
  }

  /**
   * Remove sensitive data from user object
   */
  private sanitizeUser(user: User) {
    const { password, providerId, ...sanitizedUser } = user;
    return sanitizedUser;
  }
}
