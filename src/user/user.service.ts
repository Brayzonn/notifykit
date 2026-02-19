import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { EmailService } from '@/email/email.service';
import {
  AuthProvider,
  CustomerPlan,
  JobStatus,
  JobType,
  Prisma,
} from '@prisma/client';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  UpdateEmailDto,
} from '@/user/dto';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import {
  UsageStats,
  UserProfile,
  MessageResponse,
  EmailChangeRequestResponse,
  EmailVerificationResponse,
  EmailChangeSuccessResponse,
  DashboardSummary,
  ApiKeyResponse,
  RegenerateApiKeyResponse,
  Job,
  JobsHistoryResponse,
} from './interfaces/user.interface';
import { SendGridDomainService } from '@/sendgrid/sendgrid-domain.service';
import { NotificationsService } from '@/notifications/notifications.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly sendGridDomainService: SendGridDomainService,
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
  async getUserProfile(userId: string): Promise<UserProfile> {
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
            billingCycleStartAt: true,
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
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.company && { company: dto.company }),
      },
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

    const { password, ...userWithoutPassword } = user as UserProfile & {
      password?: string;
    };
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
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<MessageResponse> {
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
  async requestEmailChange(
    userId: string,
    dto: UpdateEmailDto,
  ): Promise<EmailChangeRequestResponse> {
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
  async verifyNewEmail(token: string): Promise<EmailVerificationResponse> {
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
  async confirmOldEmail(token: string): Promise<EmailVerificationResponse> {
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
  async cancelEmailChange(token: string): Promise<MessageResponse> {
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
  private async completeEmailChange(
    userId: string,
  ): Promise<EmailChangeSuccessResponse> {
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
  async deleteAccount(
    userId: string,
    confirmEmail: string,
  ): Promise<MessageResponse> {
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
  async getDashboardSummary(
    userId: string,
    days: number = 7,
  ): Promise<DashboardSummary> {
    const startDate = this.getStartDate(days);
    const customer = await this.fetchCustomerWithJobs(userId, startDate);

    if (!customer) {
      throw new NotFoundException('Customer record not found');
    }

    const { jobs, plan, monthlyLimit, usageCount, usageResetAt } = customer;

    const jobStats = this.calculateJobStats(jobs);
    const activityByDay = this.groupJobsByDay(jobs, days);
    const remaining = Math.max(monthlyLimit - usageCount, 0);

    return {
      usage: {
        plan,
        monthlyLimit,
        used: usageCount,
        remaining,
        resetAt: usageResetAt,
      },
      jobs: jobStats,
      activityByDay,
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
  async getApiKey(userId: string): Promise<ApiKeyResponse> {
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
      apiKey: 'nh_•••••••••••••••',
      masked: true,
      createdAt: customer.createdAt,
    };
  }

  /**
   * Regenerate API key
   */
  async regenerateApiKey(
    userId: string,
    email: string,
    confirmEmail: string,
  ): Promise<RegenerateApiKeyResponse> {
    if (email !== confirmEmail) {
      throw new BadRequestException('Confirmation email does not match');
    }

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
        createdAt: new Date(),
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
  async getUsageStats(userId: string): Promise<UsageStats> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        plan: true,
        monthlyLimit: true,
        usageCount: true,
        usageResetAt: true,
        billingCycleStartAt: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer record not found');
    }

    const usagePercentage = (customer.usageCount / customer.monthlyLimit) * 100;
    const remaining = customer.monthlyLimit - customer.usageCount;
    const formattedPercentage = parseFloat(
      Math.min(usagePercentage, 100).toFixed(2),
    ).toString();

    return {
      plan: customer.plan,
      monthlyLimit: customer.monthlyLimit,
      usageCount: customer.usageCount,
      remaining: remaining > 0 ? remaining : 0,
      usagePercentage: formattedPercentage,
      usageResetAt: customer.usageResetAt,
      billingCycleStartAt: customer.billingCycleStartAt,
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
    status?: JobStatus,
    type?: JobType,
  ): Promise<JobsHistoryResponse> {
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

    if (type) {
      where.type = type;
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
      data: jobs,
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
  async getJobDetails(userId: string, jobId: string): Promise<Job> {
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

  async retryJob(userId: string, jobId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer record not found');
    }

    const result = await this.notificationsService.retryJob(customer.id, jobId);

    if (!result) {
      throw new NotFoundException(
        'Job not found or cannot be retried (must be in failed status)',
      );
    }

    return result;
  }

  /**
   * ================================
   * Domain METHODS
   * ================================
   */

  /**
   * Request domain verification
   */
  async requestDomainVerification(userId: string, domain: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        plan: true,
        sendgridDomainId: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === CustomerPlan.FREE) {
      throw new BadRequestException(
        'Custom domain is only available for paid plans (Indie, Startup)',
      );
    }

    const domainRegex =
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

    if (!domainRegex.test(domain)) {
      throw new BadRequestException('Invalid domain format');
    }

    const existingDomain = await this.prisma.customer.findFirst({
      where: {
        sendingDomain: domain,
        domainVerified: true,
        userId: { not: userId },
      },
    });

    if (existingDomain) {
      throw new BadRequestException(
        'This domain is already verified by another customer',
      );
    }

    if (customer.sendgridDomainId) {
      try {
        await this.sendGridDomainService.deleteDomain(
          parseInt(customer.sendgridDomainId),
        );
      } catch (error) {
        this.logger.warn(`Failed to delete old domain: ${error.message}`);
      }
    }

    const { domainId, dnsRecords, valid } =
      await this.sendGridDomainService.authenticateDomain(domain);

    await this.prisma.customer.update({
      where: { userId },
      data: {
        sendingDomain: domain,
        sendgridDomainId: domainId.toString(),
        domainDnsRecords: dnsRecords,
        domainVerified: valid,
        domainRequestedAt: new Date(),
        domainVerifiedAt: valid ? new Date() : null,
      },
    });

    this.logger.log(
      `Domain verification requested: ${domain} for customer: ${userId}`,
    );

    return {
      domain,
      status: valid ? 'verified' : 'pending',
      dnsRecords: dnsRecords.map((record, index) => ({
        id: index + 1,
        type: record.type,
        host: record.host,
        value: record.value,
        description: this.getDnsRecordDescription(index),
      })),
      instructions: {
        message: 'Add these DNS records to your domain registrar',
        steps: [
          '1. Login to your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.)',
          '2. Navigate to DNS settings for your domain',
          '3. Add each CNAME record below',
          '4. Wait 15-60 minutes for DNS propagation',
          '5. Click "Verify Domain" to check status',
        ],
        estimatedTime: '15-60 minutes',
      },
    };
  }

  /**
   * Check domain verification status
   */
  async checkDomainVerification(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        sendingDomain: true,
        domainVerified: true,
        sendgridDomainId: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (!customer.sendgridDomainId) {
      throw new NotFoundException(
        'No domain configured. Please add a domain first.',
      );
    }

    const { valid, validationResults } =
      await this.sendGridDomainService.validateDomain(
        parseInt(customer.sendgridDomainId),
      );

    if (valid && !customer.domainVerified) {
      await this.prisma.customer.update({
        where: { userId },
        data: {
          domainVerified: true,
          domainVerifiedAt: new Date(),
        },
      });

      this.logger.log(
        `Domain verified: ${customer.sendingDomain} for customer: ${userId}`,
      );
    }

    return {
      domain: customer.sendingDomain,
      verified: valid,
      message: valid
        ? 'Domain verified! You can now send emails from this domain.'
        : 'Domain not yet verified. DNS records may still be propagating (15-60 minutes).',
      validationResults: valid ? null : validationResults,
    };
  }

  /**
   * Get domain status
   */
  async getDomainStatus(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        sendingDomain: true,
        domainVerified: true,
        domainDnsRecords: true,
        domainRequestedAt: true,
        domainVerifiedAt: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (!customer.sendingDomain) {
      return {
        status: false,
        message: 'No custom domain configured',
      };
    }

    return {
      domain: customer.sendingDomain,
      verified: customer.domainVerified,
      status: customer.domainVerified ? 'verified' : 'pending',
      dnsRecords: customer.domainDnsRecords,
      requestedAt: customer.domainRequestedAt,
      verifiedAt: customer.domainVerifiedAt,
    };
  }

  /**
   * Remove domain verification
   */
  async removeDomain(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.sendgridDomainId) {
      try {
        await this.sendGridDomainService.deleteDomain(
          parseInt(customer.sendgridDomainId),
        );
      } catch (error) {
        this.logger.warn(
          `Failed to delete domain from SendGrid: ${error.message}`,
        );
      }
    }

    await this.prisma.customer.update({
      where: { userId },
      data: {
        sendingDomain: null,
        domainVerified: false,
        sendgridDomainId: null,
        domainDnsRecords: Prisma.JsonNull,
        domainRequestedAt: null,
        domainVerifiedAt: null,
      },
    });

    this.logger.log(`Domain removed for customer: ${userId}`);

    return { message: 'Domain removed successfully' };
  }

  private getDnsRecordDescription(index: number): string {
    const descriptions = [
      'Mail CNAME - Routes email through SendGrid',
      'DKIM 1 - Email authentication (prevents spoofing)',
      'DKIM 2 - Email authentication (backup)',
    ];
    return descriptions[index] || 'DNS Record';
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

  private getStartDate(days: number): Date {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }

  private async fetchCustomerWithJobs(userId: string, startDate: Date) {
    return this.prisma.customer.findUnique({
      where: { userId },
      select: {
        plan: true,
        monthlyLimit: true,
        usageCount: true,
        usageResetAt: true,
        jobs: {
          where: { createdAt: { gte: startDate } },
          select: { status: true, type: true, createdAt: true },
        },
      },
    });
  }

  private calculateJobStats(jobs: Array<{ status: JobStatus; type: JobType }>) {
    const totalJobs = jobs.length;
    const successfulJobs = jobs.filter((j) => j.status === 'COMPLETED').length;
    const failedJobs = jobs.filter((j) => j.status === 'FAILED').length;
    const pendingJobs = jobs.filter(
      (j) => j.status === 'PENDING' || j.status === 'PROCESSING',
    ).length;
    const emailJobs = jobs.filter((j) => j.type === 'EMAIL').length;
    const webhookJobs = jobs.filter((j) => j.type === 'WEBHOOK').length;

    const successRate =
      totalJobs > 0 ? ((successfulJobs / totalJobs) * 100).toFixed(2) : '0';

    return {
      total: totalJobs,
      successful: successfulJobs,
      failed: failedJobs,
      pending: pendingJobs,
      successRate: `${successRate}%`,
      emailJobs,
      webhookJobs,
    };
  }

  private groupJobsByDay(
    jobs: Array<{ createdAt: Date; status: JobStatus }>,
    days: number,
  ) {
    const activityMap = this.initializeActivityMap(days);

    for (const job of jobs) {
      const dateStr = job.createdAt.toISOString().split('T')[0];
      const entry = activityMap.get(dateStr);
      if (entry) {
        entry.total++;
        if (job.status === JobStatus.COMPLETED) entry.successful++;
        if (job.status === JobStatus.FAILED) entry.failed++;
        if (
          job.status === JobStatus.PENDING ||
          job.status === JobStatus.PROCESSING
        )
          entry.pending++;
      }
    }

    return Array.from(activityMap.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private initializeActivityMap(days: number) {
    const activityMap = new Map<
      string,
      { total: number; pending: number; successful: number; failed: number }
    >();

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      activityMap.set(dateStr, {
        total: 0,
        pending: 0,
        successful: 0,
        failed: 0,
      });
    }

    return activityMap;
  }
}
