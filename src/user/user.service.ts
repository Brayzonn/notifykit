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
import { EncryptionService } from '@/common/encryption/encryption.service';
import axios from 'axios';
import {
  AuthProvider,
  CustomerPlan,
  EmailProviderType,
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
  JobDetailsResponse,
  JobsHistoryResponse,
} from './interfaces/user.interface';
import { SendGridDomainService } from '@/sendgrid/sendgrid-domain.service';
import { ResendDomainService } from '@/email-providers/resend-domain.service';
import { NotificationsService } from '@/notifications/notifications.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly sendGridDomainService: SendGridDomainService,
    private readonly resendDomainService: ResendDomainService,
    private readonly redis: RedisService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
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
            sendingDomains: {
              select: { domain: true, provider: true, verified: true, requestedAt: true, verifiedAt: true },
            },
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
            sendingDomains: {
              select: { domain: true, provider: true, verified: true, requestedAt: true, verifiedAt: true },
            },
          },
        },
      },
    });

    await this.redis.del(`user:${userId}`);

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

    await this.redis.del(`user:${userId}`);

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

    await this.redis.del(`user:${userId}`);

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
    await this.redis.del(`user:${userId}`);

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
        apiKeyLastFour: true,
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

    const lastFour = customer.apiKeyLastFour ?? '••••';

    return {
      apiKey: `nh_••••••••••••••••${lastFour}`,
      masked: true,
      createdAt: customer.createdAt,
    };
  }

  /**
   * Regenerate users API key
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

    const lastFour = newApiKey.slice(-4);

    await this.prisma.customer.update({
      where: { userId },
      data: {
        apiKey: newApiKey,
        apiKeyHash: newApiKeyHash,
        apiKeyLastFour: lastFour,
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
   * SENDGRID KEY MANAGEMENT
   * ================================
   */

  async saveCustomerSendgridKey(
    userId: string,
    apiKey: string,
  ): Promise<MessageResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, plan: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === CustomerPlan.FREE) {
      throw new BadRequestException(
        'SendGrid API key is only available for paid plans',
      );
    }

    const isValid = await this.validateCustomerSendgridKey(apiKey);
    if (!isValid) {
      throw new BadRequestException('Invalid SendGrid API key');
    }

    const encryptedKey = this.encryptionService.encrypt(apiKey);
    const nextPriority = await this.getNextProviderPriority(customer.id, EmailProviderType.SENDGRID);

    await this.prisma.customerEmailProvider.upsert({
      where: { customerId_provider: { customerId: customer.id, provider: EmailProviderType.SENDGRID } },
      create: { customerId: customer.id, provider: EmailProviderType.SENDGRID, apiKey: encryptedKey, priority: nextPriority },
      update: { apiKey: encryptedKey },
    });

    return { message: 'SendGrid API key saved successfully' };
  }

  async getCustomerSendgridKey(userId: string): Promise<{
    hasKey: boolean;
    addedAt: Date | null;
    lastFour: string | null;
    priority: number | null;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const record = await this.prisma.customerEmailProvider.findUnique({
      where: { customerId_provider: { customerId: customer.id, provider: EmailProviderType.SENDGRID } },
    });

    if (!record) {
      return { hasKey: false, addedAt: null, lastFour: null, priority: null };
    }

    const decrypted = this.encryptionService.decrypt(record.apiKey);
    return {
      hasKey: true,
      addedAt: record.addedAt,
      lastFour: decrypted.slice(-4),
      priority: record.priority,
    };
  }

  async removeCustomerSendgridKey(userId: string): Promise<MessageResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        id: true,
        emailProviders: { where: { provider: EmailProviderType.SENDGRID } },
        sendingDomains: { where: { provider: EmailProviderType.SENDGRID }, select: { id: true, providerDomainId: true } },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const sendgridRecord = customer.emailProviders[0];

    for (const sendingDomain of customer.sendingDomains) {
      if (sendingDomain.providerDomainId && sendgridRecord) {
        const decryptedKey = this.encryptionService.decrypt(sendgridRecord.apiKey);
        try {
          await this.sendGridDomainService.deleteDomain(
            parseInt(sendingDomain.providerDomainId),
            decryptedKey,
          );
        } catch (error) {
          this.logger.warn(`Failed to delete domain from SendGrid during key removal: ${error.message}`);
        }
      }
    }

    await this.prisma.$transaction([
      this.prisma.customerEmailProvider.deleteMany({
        where: { customerId: customer.id, provider: EmailProviderType.SENDGRID },
      }),
      this.prisma.customerSendingDomain.deleteMany({
        where: { customerId: customer.id, provider: EmailProviderType.SENDGRID },
      }),
    ]);

    return { message: 'SendGrid API key removed successfully' };
  }

  /**
   * ================================
   * SENDGRID WEBHOOK KEY MANAGEMENT
   * ================================
   */

  async saveSendgridWebhookKey(
    userId: string,
    webhookKey: string,
  ): Promise<{ message: string; webhookUrl: string }> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, plan: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === CustomerPlan.FREE) {
      throw new BadRequestException(
        'SendGrid webhook key is only available for paid plans',
      );
    }

    const updated = await this.prisma.customerEmailProvider.updateMany({
      where: { customerId: customer.id, provider: EmailProviderType.SENDGRID },
      data: { webhookSecret: webhookKey, webhookSecretAddedAt: new Date() },
    });

    if (updated.count === 0) {
      throw new BadRequestException(
        'No SendGrid API key found. Please add SendGrid as an email provider first.',
      );
    }

    const webhookUrl = this.buildWebhookUrl(customer.id);

    return {
      message: 'SendGrid webhook verification key saved successfully',
      webhookUrl,
    };
  }

  async getSendgridWebhookKey(userId: string): Promise<{
    hasKey: boolean;
    addedAt: Date | null;
    webhookUrl: string | null;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, plan: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === CustomerPlan.FREE) {
      return { hasKey: false, addedAt: null, webhookUrl: null };
    }

    const record = await this.prisma.customerEmailProvider.findUnique({
      where: { customerId_provider: { customerId: customer.id, provider: EmailProviderType.SENDGRID } },
      select: { webhookSecret: true, webhookSecretAddedAt: true },
    });

    return {
      hasKey: !!record?.webhookSecret,
      addedAt: record?.webhookSecretAddedAt ?? null,
      webhookUrl: this.buildWebhookUrl(customer.id),
    };
  }

  async removeSendgridWebhookKey(userId: string): Promise<MessageResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    await this.prisma.customerEmailProvider.updateMany({
      where: { customerId: customer.id, provider: EmailProviderType.SENDGRID },
      data: { webhookSecret: null, webhookSecretAddedAt: null },
    });

    return { message: 'SendGrid webhook verification key removed successfully' };
  }

  /**
   * ================================
   * RESEND WEBHOOK KEY MANAGEMENT
   * ================================
   */

  async saveResendWebhookSecret(
    userId: string,
    secret: string,
  ): Promise<{ message: string; webhookUrl: string }> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, plan: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === CustomerPlan.FREE) {
      throw new BadRequestException(
        'Resend webhook secret is only available for paid plans',
      );
    }

    const updated = await this.prisma.customerEmailProvider.updateMany({
      where: { customerId: customer.id, provider: EmailProviderType.RESEND },
      data: { webhookSecret: secret, webhookSecretAddedAt: new Date() },
    });

    if (updated.count === 0) {
      throw new BadRequestException(
        'No Resend API key found. Please add Resend as an email provider first.',
      );
    }

    return {
      message: 'Resend webhook signing secret saved successfully',
      webhookUrl: this.buildResendWebhookUrl(customer.id),
    };
  }

  async getResendWebhookSecret(userId: string): Promise<{
    hasKey: boolean;
    addedAt: Date | null;
    webhookUrl: string | null;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, plan: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === CustomerPlan.FREE) {
      return { hasKey: false, addedAt: null, webhookUrl: null };
    }

    const record = await this.prisma.customerEmailProvider.findUnique({
      where: { customerId_provider: { customerId: customer.id, provider: EmailProviderType.RESEND } },
      select: { webhookSecret: true, webhookSecretAddedAt: true },
    });

    return {
      hasKey: !!record?.webhookSecret,
      addedAt: record?.webhookSecretAddedAt ?? null,
      webhookUrl: this.buildResendWebhookUrl(customer.id),
    };
  }

  async removeResendWebhookSecret(userId: string): Promise<MessageResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    await this.prisma.customerEmailProvider.updateMany({
      where: { customerId: customer.id, provider: EmailProviderType.RESEND },
      data: { webhookSecret: null, webhookSecretAddedAt: null },
    });

    return { message: 'Resend webhook signing secret removed successfully' };
  }

  private buildResendWebhookUrl(customerId: string): string {
    const baseUrl = this.configService.get<string>(
      'BACKEND_URL',
      'https://api.notifykit.dev',
    );
    return `${baseUrl}/api/v1/webhooks/resend/${customerId}`;
  }

  /**
   * ================================
   * RESEND KEY MANAGEMENT
   * ================================
   */

  async saveCustomerResendKey(
    userId: string,
    apiKey: string,
  ): Promise<MessageResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, plan: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.plan === CustomerPlan.FREE) {
      throw new BadRequestException(
        'Resend API key is only available for paid plans',
      );
    }

    const isValid = await this.validateCustomerResendKey(apiKey);
    if (!isValid) {
      throw new BadRequestException('Invalid Resend API key');
    }

    const encryptedKey = this.encryptionService.encrypt(apiKey);
    const nextPriority = await this.getNextProviderPriority(customer.id, EmailProviderType.RESEND);

    await this.prisma.customerEmailProvider.upsert({
      where: { customerId_provider: { customerId: customer.id, provider: EmailProviderType.RESEND } },
      create: { customerId: customer.id, provider: EmailProviderType.RESEND, apiKey: encryptedKey, priority: nextPriority },
      update: { apiKey: encryptedKey },
    });

    return { message: 'Resend API key saved successfully' };
  }

  async getCustomerResendKey(userId: string): Promise<{
    hasKey: boolean;
    addedAt: Date | null;
    lastFour: string | null;
    priority: number | null;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const record = await this.prisma.customerEmailProvider.findUnique({
      where: { customerId_provider: { customerId: customer.id, provider: EmailProviderType.RESEND } },
    });

    if (!record) {
      return { hasKey: false, addedAt: null, lastFour: null, priority: null };
    }

    const decrypted = this.encryptionService.decrypt(record.apiKey);
    return {
      hasKey: true,
      addedAt: record.addedAt,
      lastFour: decrypted.slice(-4),
      priority: record.priority,
    };
  }

  async removeCustomerResendKey(userId: string): Promise<MessageResponse> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        id: true,
        emailProviders: { where: { provider: EmailProviderType.RESEND } },
        sendingDomains: { where: { provider: EmailProviderType.RESEND }, select: { id: true, providerDomainId: true } },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const resendRecord = customer.emailProviders[0];

    for (const sendingDomain of customer.sendingDomains) {
      if (sendingDomain.providerDomainId && resendRecord) {
        const decryptedKey = this.encryptionService.decrypt(resendRecord.apiKey);
        try {
          await this.resendDomainService.deleteDomain(
            sendingDomain.providerDomainId,
            decryptedKey,
          );
        } catch (error) {
          this.logger.warn(`Failed to delete domain from Resend during key removal: ${error.message}`);
        }
      }
    }

    await this.prisma.$transaction([
      this.prisma.customerEmailProvider.deleteMany({
        where: { customerId: customer.id, provider: EmailProviderType.RESEND },
      }),
      this.prisma.customerSendingDomain.deleteMany({
        where: { customerId: customer.id, provider: EmailProviderType.RESEND },
      }),
    ]);

    return { message: 'Resend API key removed successfully' };
  }

  async getEmailProviderStatus(userId: string): Promise<{
    providers: { provider: EmailProviderType; addedAt: Date; lastFour: string; priority: number }[];
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const records = await this.prisma.customerEmailProvider.findMany({
      where: { customerId: customer.id },
      orderBy: { priority: 'asc' },
    });

    return {
      providers: records.map((r) => ({
        provider: r.provider,
        addedAt: r.addedAt,
        lastFour: this.encryptionService.decrypt(r.apiKey).slice(-4),
        priority: r.priority,
      })),
    };
  }

  async updateEmailProviderPriority(
    userId: string,
    providerParam: string,
    newPriority: number,
  ): Promise<{ providers: { provider: EmailProviderType; priority: number }[] }> {
    const providerType = EmailProviderType[providerParam.toUpperCase() as keyof typeof EmailProviderType];
    if (!providerType) {
      throw new BadRequestException(`Unknown provider: ${providerParam}`);
    }

    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const record = await this.prisma.customerEmailProvider.findUnique({
      where: { customerId_provider: { customerId: customer.id, provider: providerType } },
    });

    if (!record) {
      throw new NotFoundException(`No ${providerParam} API key configured`);
    }

    // Swap priorities atomically: displace occupant to old priority, then set new priority
    await this.prisma.$transaction([
      this.prisma.customerEmailProvider.updateMany({
        where: { customerId: customer.id, priority: newPriority, provider: { not: providerType } },
        data: { priority: record.priority },
      }),
      this.prisma.customerEmailProvider.update({
        where: { customerId_provider: { customerId: customer.id, provider: providerType } },
        data: { priority: newPriority },
      }),
    ]);

    const updated = await this.prisma.customerEmailProvider.findMany({
      where: { customerId: customer.id },
      orderBy: { priority: 'asc' },
      select: { provider: true, priority: true },
    });

    return { providers: updated };
  }

  private async getNextProviderPriority(customerId: string, provider: EmailProviderType): Promise<number> {
    // If the provider already exists, priority is irrelevant (upsert will keep existing)
    const existing = await this.prisma.customerEmailProvider.findUnique({
      where: { customerId_provider: { customerId, provider } },
      select: { priority: true },
    });
    if (existing) return existing.priority;

    const aggregate = await this.prisma.customerEmailProvider.aggregate({
      where: { customerId },
      _max: { priority: true },
    });
    return (aggregate._max.priority ?? 0) + 1;
  }

  private async validateCustomerResendKey(apiKey: string): Promise<boolean> {
    try {
      const response = await axios.get('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private buildWebhookUrl(customerId: string): string {
    const baseUrl = this.configService.get<string>(
      'BACKEND_URL',
      'https://api.notifykit.dev',
    );
    return `${baseUrl}/api/v1/webhooks/sendgrid/${customerId}`;
  }

  private async validateCustomerSendgridKey(apiKey: string): Promise<boolean> {
    try {
      const response = await axios.get('https://api.sendgrid.com/v3/scopes', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return response.status === 200;
    } catch {
      return false;
    }
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
          emailEvents: {
            orderBy: { occurredAt: 'desc' },
            take: 1,
            select: {
              event: true,
              occurredAt: true,
            },
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
  async getJobDetails(userId: string, jobId: string): Promise<JobDetailsResponse> {
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
        emailEvents: {
          orderBy: { occurredAt: 'desc' },
          select: {
            id: true,
            event: true,
            email: true,
            occurredAt: true,
            metadata: true,
          },
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
      select: { id: true, plan: true },
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

    const emailProviders = await this.prisma.customerEmailProvider.findMany({
      where: { customerId: customer.id },
    });

    if (emailProviders.length === 0) {
      throw new BadRequestException(
        'Domain verification requires at least one email provider configured in your settings.',
      );
    }

    const existingDomain = await this.prisma.customerSendingDomain.findFirst({
      where: {
        domain,
        customer: { userId: { not: userId } },
      },
    });

    if (existingDomain) {
      throw new BadRequestException(
        'This domain is already registered by another customer',
      );
    }

    const allDnsRecords: Array<{
      id: number;
      type: string;
      host: string;
      value: string;
      provider: string;
    }> = [];

    let anyValid = false;

    for (const providerRecord of emailProviders) {
      const decryptedKey = this.encryptionService.decrypt(providerRecord.apiKey);
      const provider = providerRecord.provider;

      let domainId: string;
      let dnsRecords: Array<{ type: string; host: string; value: string }>;
      let valid: boolean;

      if (provider === EmailProviderType.SENDGRID) {
        const existingRow = await this.prisma.customerSendingDomain.findUnique({
          where: { customerId_domain_provider: { customerId: customer.id, domain, provider } },
        });

        if (existingRow?.providerDomainId) {
          try {
            await this.sendGridDomainService.deleteDomain(
              parseInt(existingRow.providerDomainId),
              decryptedKey,
            );
          } catch (error) {
            this.logger.warn(`Failed to delete old SendGrid domain: ${error.message}`);
          }
        }

        const result = await this.sendGridDomainService.authenticateDomain(domain, decryptedKey);
        domainId = result.domainId.toString();
        dnsRecords = result.dnsRecords;
        valid = result.valid;
      } else if (provider === EmailProviderType.RESEND) {
        const result = await this.resendDomainService.authenticateDomain(domain, decryptedKey);
        domainId = result.domainId;
        dnsRecords = result.dnsRecords;
        valid = result.valid;
      } else {
        continue;
      }

      await this.prisma.customerSendingDomain.upsert({
        where: { customerId_domain_provider: { customerId: customer.id, domain, provider } },
        create: {
          customerId: customer.id,
          domain,
          provider,
          providerDomainId: domainId,
          dnsRecords,
          verified: valid,
          requestedAt: new Date(),
          verifiedAt: valid ? new Date() : null,
        },
        update: {
          providerDomainId: domainId,
          dnsRecords,
          verified: valid,
          requestedAt: new Date(),
          verifiedAt: valid ? new Date() : null,
        },
      });

      if (valid) anyValid = true;

      for (const record of dnsRecords) {
        allDnsRecords.push({
          id: allDnsRecords.length + 1,
          type: record.type,
          host: record.host,
          value: record.value,
          provider,
        });
      }
    }

    this.logger.log(
      `Domain verification requested: ${domain} for customer: ${userId}`,
    );

    return {
      domain,
      status: anyValid ? 'verified' : 'pending',
      dnsRecords: allDnsRecords,
      instructions: {
        message: 'Add these DNS records to your domain registrar',
        steps: [
          '1. Login to your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.)',
          '2. Navigate to DNS settings for your domain',
          '3. Add each DNS record below',
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
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const domainRows = await this.prisma.customerSendingDomain.findMany({
      where: { customerId: customer.id },
    });

    if (domainRows.length === 0) {
      throw new NotFoundException(
        'No domain configured. Please add a domain first.',
      );
    }

    const domain = domainRows[0].domain;
    const providerResults: Array<{
      provider: string;
      verified: boolean;
      validationResults: any;
    }> = [];

    for (const row of domainRows) {
      if (!row.providerDomainId) continue;

      const providerRecord = await this.prisma.customerEmailProvider.findUnique({
        where: { customerId_provider: { customerId: customer.id, provider: row.provider } },
      });

      if (!providerRecord) continue;

      const decryptedKey = this.encryptionService.decrypt(providerRecord.apiKey);

      let valid: boolean;
      let validationResults: any;

      if (row.provider === EmailProviderType.SENDGRID) {
        const result = await this.sendGridDomainService.validateDomain(
          parseInt(row.providerDomainId),
          decryptedKey,
        );
        valid = result.valid;
        validationResults = result.validationResults;
      } else if (row.provider === EmailProviderType.RESEND) {
        const result = await this.resendDomainService.validateDomain(
          row.providerDomainId,
          decryptedKey,
        );
        valid = result.valid;
        validationResults = result.validationResults;
      } else {
        continue;
      }

      if (valid && !row.verified) {
        await this.prisma.customerSendingDomain.update({
          where: { id: row.id },
          data: { verified: true, verifiedAt: new Date() },
        });
        this.logger.log(
          `Domain verified via ${row.provider}: ${row.domain} for customer: ${userId}`,
        );
      }

      providerResults.push({
        provider: row.provider,
        verified: valid,
        validationResults: valid ? null : validationResults,
      });
    }

    const allVerified = providerResults.length > 0 && providerResults.every((r) => r.verified);
    const anyVerified = providerResults.some((r) => r.verified);

    return {
      domain,
      verified: allVerified,
      providers: providerResults,
      message: allVerified
        ? 'Domain verified! You can now send emails from this domain.'
        : anyVerified
        ? 'Domain partially verified. Some providers are still pending DNS propagation.'
        : 'Domain not yet verified. DNS records may still be propagating (15-60 minutes).',
    };
  }

  /**
   * Get domain status
   */
  async getDomainStatus(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const domains = await this.prisma.customerSendingDomain.findMany({
      where: { customerId: customer.id },
      select: {
        domain: true,
        provider: true,
        verified: true,
        dnsRecords: true,
        requestedAt: true,
        verifiedAt: true,
      },
      orderBy: { requestedAt: 'desc' },
    });

    if (domains.length === 0) {
      return {
        status: false,
        message: 'No custom domain configured',
      };
    }

    return {
      domains: domains.map((d) => ({
        ...d,
        dnsRecords: Array.isArray(d.dnsRecords)
          ? (d.dnsRecords as any[]).map((record, index) => ({
              id: index + 1,
              type: record.type,
              host: record.host,
              value: record.value,
              provider: d.provider,
            }))
          : [],
      })),
    };
  }

  /**
   * Remove domain verification
   */
  async removeDomain(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: {
        id: true,
        sendingDomains: { select: { id: true, provider: true, providerDomainId: true } },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const emailProviders = await this.prisma.customerEmailProvider.findMany({
      where: { customerId: customer.id },
    });

    const providerKeyMap = new Map(
      emailProviders.map((p) => [p.provider, this.encryptionService.decrypt(p.apiKey)]),
    );

    for (const sendingDomain of customer.sendingDomains) {
      if (!sendingDomain.providerDomainId) continue;

      const decryptedKey = providerKeyMap.get(sendingDomain.provider);

      if (!decryptedKey) continue;

      if (sendingDomain.provider === EmailProviderType.SENDGRID) {
        try {
          await this.sendGridDomainService.deleteDomain(
            parseInt(sendingDomain.providerDomainId),
            decryptedKey,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to delete domain from SendGrid: ${error.message}`,
          );
        }
      } else if (sendingDomain.provider === EmailProviderType.RESEND) {
        try {
          await this.resendDomainService.deleteDomain(
            sendingDomain.providerDomainId,
            decryptedKey,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to delete domain from Resend: ${error.message}`,
          );
        }
      }
    }

    await this.prisma.customerSendingDomain.deleteMany({
      where: { customerId: customer.id },
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
