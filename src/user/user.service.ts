import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { EmailService } from '@/email/email.service';
import { AuthProvider } from '@prisma/client';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  UpdateEmailDto,
} from '@/user/dto';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * ================================
   * PROFILE MANAGEMENT
   * ================================
   */

  /**
   * Get user profile with customer data
   */
  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: {
          select: {
            id: true,
            plan: true,
            monthlyLimit: true,
            usageCount: true,
            usageResetAt: true,
            isActive: true,
            createdAt: true,
            sendingDomain: true,
            domainVerified: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  /**
   * Update user profile (name, company)
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.company && { company: dto.company }),
      },
    });

    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  /**
   * ================================
   * ACCOUNT MANAGEMENT
   * ================================
   */

  /**
   * Change password (only for email auth users)
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.provider !== AuthProvider.EMAIL) {
      throw new BadRequestException(
        'Password change is only available for email authentication',
      );
    }

    if (!user.password) {
      throw new BadRequestException('User has no password set');
    }

    const isPasswordValid = await argon2.verify(
      user.password,
      dto.currentPassword,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await argon2.hash(dto.newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Password changed successfully' };
  }

  /**
   * Request email change
   */
  async requestEmailChange(userId: string, dto: UpdateEmailDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // For email auth users
    if (user.provider === AuthProvider.EMAIL) {
      if (!dto.password) {
        throw new BadRequestException('Password is required');
      }

      if (!user.password) {
        throw new BadRequestException('User has no password set');
      }

      const isPasswordValid = await argon2.verify(user.password, dto.password);

      if (!isPasswordValid) {
        throw new UnauthorizedException('Password is incorrect');
      }
    }

    // Check if new email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.newEmail },
    });

    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    // Generate secure tokens for both emails
    const newEmailToken = crypto.randomBytes(32).toString('hex');
    const oldEmailToken = crypto.randomBytes(32).toString('hex');

    await this.redis.set(
      `email-change:${userId}`,
      JSON.stringify({
        oldEmail: user.email,
        newEmail: dto.newEmail,
        newEmailToken,
        oldEmailToken,
        newEmailConfirmed: false,
        oldEmailConfirmed: false,
      }),
      1800, // 30 minutes
    );

    await this.redis.set(`token:${newEmailToken}`, userId, 1800);
    await this.redis.set(`token:${oldEmailToken}`, userId, 1800);

    const frontendUrl = this.configService.get<string>('FRONTEND_URL');

    // Send verification link to NEW email
    await this.emailService.sendEmailChangeVerification({
      email: dto.newEmail,
      name: user.name,
      verifyLink: `${frontendUrl}/auth/verify-email-change/${newEmailToken}`,
    });

    // Send confirmation link to OLD email
    await this.emailService.sendEmailChangeConfirmation({
      email: user.email,
      name: user.name,
      newEmail: dto.newEmail,
      confirmLink: `${frontendUrl}/auth/confirm-email-change/${oldEmailToken}`,
      cancelLink: `${frontendUrl}/auth/cancel-email-change/${oldEmailToken}`,
    });

    return {
      message:
        'Verification emails sent. Please confirm from both your old and new email addresses.',
      expiresIn: 1800,
    };
  }

  /**
   * Verify new email (user clicks link from new email)
   */
  async verifyNewEmail(token: string) {
    const userId = await this.redis.get(`token:${token}`);

    if (!userId) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    const dataStr = await this.redis.get(`email-change:${userId}`);

    if (!dataStr) {
      throw new UnauthorizedException('Email change request not found');
    }

    const data = JSON.parse(dataStr);

    if (data.newEmailToken !== token) {
      throw new UnauthorizedException('Invalid verification token');
    }

    data.newEmailConfirmed = true;
    await this.redis.set(`email-change:${userId}`, JSON.stringify(data), 1800);

    if (data.newEmailConfirmed && data.oldEmailConfirmed) {
      await this.completeEmailChange(userId);
    }

    return {
      message: 'New email verified. Waiting for confirmation from old email.',
      bothConfirmed: data.oldEmailConfirmed,
    };
  }

  /**
   * Confirm from old email (user clicks link from old email)
   */
  async confirmOldEmail(token: string) {
    const userId = await this.redis.get(`token:${token}`);

    if (!userId) {
      throw new UnauthorizedException('Invalid or expired confirmation token');
    }

    const dataStr = await this.redis.get(`email-change:${userId}`);

    if (!dataStr) {
      throw new UnauthorizedException('Email change request not found');
    }

    const data = JSON.parse(dataStr);

    if (data.oldEmailToken !== token) {
      throw new UnauthorizedException('Invalid confirmation token');
    }

    data.oldEmailConfirmed = true;
    await this.redis.set(`email-change:${userId}`, JSON.stringify(data), 1800);

    if (data.newEmailConfirmed && data.oldEmailConfirmed) {
      await this.completeEmailChange(userId);
    }

    return {
      message: 'Old email confirmed. Waiting for verification from new email.',
      bothConfirmed: data.newEmailConfirmed,
    };
  }

  /**
   * Cancel email change
   */
  async cancelEmailChange(token: string) {
    const userId = await this.redis.get(`token:${token}`);

    if (!userId) {
      throw new UnauthorizedException('Invalid or expired cancellation token');
    }

    const dataStr = await this.redis.get(`email-change:${userId}`);

    if (!dataStr) {
      throw new UnauthorizedException('Email change request not found');
    }

    const data = JSON.parse(dataStr);

    if (data.oldEmailToken !== token) {
      throw new UnauthorizedException('Invalid cancellation token');
    }

    await this.redis.del(`email-change:${userId}`);
    await this.redis.del(`token:${data.newEmailToken}`);
    await this.redis.del(`token:${data.oldEmailToken}`);

    await this.emailService.sendEmailChangeCancelled({
      email: data.oldEmail,
      newEmail: data.newEmail,
    });

    return {
      message: 'Email change cancelled successfully',
    };
  }

  /**
   * Complete email change
   */
  private async completeEmailChange(userId: string) {
    const dataStr = await this.redis.get(`email-change:${userId}`);

    if (!dataStr) {
      throw new NotFoundException('Email change request not found');
    }

    const data = JSON.parse(dataStr);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: data.newEmail,
        emailVerified: true,
      },
    });

    await this.prisma.customer.update({
      where: { userId },
      data: { email: data.newEmail },
    });

    await this.redis.del(`email-change:${userId}`);
    await this.redis.del(`token:${data.newEmailToken}`);
    await this.redis.del(`token:${data.oldEmailToken}`);

    await this.emailService.sendEmailChangeSuccess({
      email: data.newEmail,
    });

    return {
      message: 'Email changed successfully',
      newEmail: data.newEmail,
    };
  }

  /**
   * Delete account (soft delete)
   */
  async deleteAccount(userId: string, confirmEmail: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.email !== confirmEmail) {
      throw new UnauthorizedException('Email confirmation does not match');
    }

    // Soft delete user
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
      },
    });

    // Deactivate customer
    await this.prisma.customer.update({
      where: { userId },
      data: { isActive: false },
    });

    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    return { message: 'Account deleted successfully' };
  }

  /**
   * ================================
   * DASHBOARD
   * ================================
   */

  /**
   * Get dashboard summary
   */
  async getDashboardSummary(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        plan: true,
        monthlyLimit: true,
        usageCount: true,
        usageResetAt: true,
        jobs: {
          where: {
            createdAt: {
              gte: new Date(new Date().setDate(new Date().getDate() - 7)),
            },
          },
          select: {
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer record not found');
    }

    const totalJobs = customer.jobs.length;
    const successfulJobs = customer.jobs.filter(
      (j) => j.status === 'COMPLETED',
    ).length;
    const failedJobs = customer.jobs.filter(
      (j) => j.status === 'FAILED',
    ).length;
    const pendingJobs = customer.jobs.filter(
      (j) => j.status === 'PENDING' || j.status === 'PROCESSING',
    ).length;

    const successRate =
      totalJobs > 0 ? ((successfulJobs / totalJobs) * 100).toFixed(2) : '0';

    const remaining = customer.monthlyLimit - customer.usageCount;

    return {
      usage: {
        plan: customer.plan,
        monthlyLimit: customer.monthlyLimit,
        used: customer.usageCount,
        remaining: remaining > 0 ? remaining : 0,
        resetAt: customer.usageResetAt,
      },
      jobs: {
        total: totalJobs,
        successful: successfulJobs,
        failed: failedJobs,
        pending: pendingJobs,
        successRate: `${successRate}%`,
      },
    };
  }

  /**
   * ================================
   * API KEY MANAGEMENT
   * ================================
   */

  /**
   * Get user's API key (masked)
   */
  async getApiKey(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        apiKey: true,
        apiKeyHash: true,
        createdAt: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer record not found');
    }

    if (!customer.apiKeyHash) {
      throw new NotFoundException(
        'No API key generated yet. Please generate one.',
      );
    }

    if (customer.apiKey) {
      const plaintext = customer.apiKey;

      await this.prisma.customer.update({
        where: { userId },
        data: { apiKey: null },
      });

      return {
        apiKey: plaintext,
        firstTime: true,
        createdAt: customer.createdAt,
      };
    }

    return {
      apiKey: 'nh_••••••••••••••••••••••••••••••••••••••••••••••••••••••••',
      masked: true,
      createdAt: customer.createdAt,
    };
  }

  /**
   * Regenerate API key
   */
  async regenerateApiKey(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { customer: true },
    });

    if (!user || !user.customer) {
      throw new NotFoundException('Customer record not found');
    }

    const newApiKey = this.generateApiKey();
    const newApiKeyHash = crypto
      .createHash('sha256')
      .update(newApiKey)
      .digest('hex');

    await this.prisma.customer.update({
      where: { userId },
      data: {
        apiKey: newApiKey,
        apiKeyHash: newApiKeyHash,
      },
    });

    return {
      apiKey: newApiKey,
      message:
        "API key generated successfully. Save it securely - you won't see it again.",
    };
  }

  /**
   * ================================
   * USAGE & BILLING
   * ================================
   */

  /**
   * Get usage statistics
   */
  async getUsageStats(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        plan: true,
        monthlyLimit: true,
        usageCount: true,
        usageResetAt: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer record not found');
    }

    const usagePercentage = (customer.usageCount / customer.monthlyLimit) * 100;
    const remaining = customer.monthlyLimit - customer.usageCount;

    return {
      plan: customer.plan,
      monthlyLimit: customer.monthlyLimit,
      usageCount: customer.usageCount,
      remaining: remaining > 0 ? remaining : 0,
      usagePercentage: Math.min(usagePercentage, 100).toFixed(2),
      usageResetAt: customer.usageResetAt,
    };
  }

  /**
   * ================================
   * JOBS/NOTIFICATIONS HISTORY
   * ================================
   */

  /**
   * Get user's jobs history with pagination
   */
  async getJobsHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
    status?: string,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer record not found');
    }

    const skip = (page - 1) * limit;
    const where: any = { customerId: customer.id };

    if (status) {
      where.status = status;
    }

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          deliveryLogs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      jobs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single job details
   */
  async getJobDetails(userId: string, jobId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer record not found');
    }

    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        customerId: customer.id,
      },
      include: {
        deliveryLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }

  /**
   * ================================
   * HELPER METHODS
   * ================================
   */

  /**
   * Generate API key
   */
  private generateApiKey(): string {
    const randomBytes = crypto.randomBytes(32);
    return `nh_${randomBytes.toString('hex')}`;
  }
}
