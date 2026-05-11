import { Injectable, Logger } from '@nestjs/common';
import {
  DomainProviderAddedEmailData,
  EmailChangeCancelledData,
  EmailChangeConfirmationData,
  EmailChangeSuccessData,
  EmailChangeVerificationData,
  OtpEmailData,
  PaymentFailedEmailData,
  WelcomeEmailData,
} from '@/email/interfaces/email.interface';
import { otpEmailTemplate } from '@/email/templates/otp.template';
import { welcomeEmailTemplate } from '@/email/templates/welcome.template';
import { passwordResetEmailTemplate } from '@/email/templates/password-reset.template';
import { emailChangeVerificationTemplate } from '@/email/templates/email-change-verification.template';
import { emailChangeConfirmationTemplate } from '@/email/templates/email-change-confirmation.template';
import { emailChangeCancelledTemplate } from '@/email/templates/email-change-cancelled.template';
import { emailChangeSuccessTemplate } from '@/email/templates/email-change-success.template';
import { paymentFailedEmailTemplate } from './templates/payment-failed.template';
import { resetPasswordEmailTemplate } from './templates/reset-password.template';
import { domainProviderAddedTemplate } from '@/email/templates/domain-provider-added.template';
import { QueueService } from '@/queues/queue.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly queueService: QueueService) {}

  private enqueue(to: string, subject: string, html: string, label: string): Promise<void> {
    return this.queueService.enqueuePlatformEmail({ to, subject, html, label });
  }

  async sendOtpEmail(data: OtpEmailData): Promise<void> {
    await this.enqueue(
      data.email,
      'Verify Your Email - NotifyKit',
      otpEmailTemplate(data.otp, data.expiresInMinutes),
      'otp',
    );
    this.logger.log(`OTP email queued for ${data.email}`);
  }

  async sendResetPasswordEmail(data: OtpEmailData): Promise<void> {
    await this.enqueue(
      data.email,
      'Reset Your Password - NotifyKit',
      resetPasswordEmailTemplate(data.otp, data.expiresInMinutes),
      'reset-password-otp',
    );
    this.logger.log(`Password reset email queued for ${data.email}`);
  }

  async sendWelcomeEmail(data: WelcomeEmailData): Promise<void> {
    await this.enqueue(
      data.email,
      'Welcome to NotifyKit',
      welcomeEmailTemplate(data.name),
      'welcome',
    );
    this.logger.log(`Welcome email queued for ${data.email}`);
  }

  async sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    await this.enqueue(
      email,
      'Reset Your Password - NotifyKit',
      passwordResetEmailTemplate(resetUrl),
      'password-reset',
    );
    this.logger.log(`Password reset email queued for ${email}`);
  }

  async sendEmailChangeVerification(data: EmailChangeVerificationData): Promise<void> {
    await this.enqueue(
      data.email,
      'Verify Your New Email Address - NotifyKit',
      emailChangeVerificationTemplate(data.name, data.verifyLink),
      'email-change-verify',
    );
    this.logger.log(`Email change verification queued for ${data.email}`);
  }

  async sendEmailChangeConfirmation(data: EmailChangeConfirmationData): Promise<void> {
    await this.enqueue(
      data.email,
      'Confirm Email Change Request - NotifyKit',
      emailChangeConfirmationTemplate(data.name, data.email, data.newEmail, data.confirmLink, data.cancelLink),
      'email-change-confirm',
    );
    this.logger.log(`Email change confirmation queued for ${data.email}`);
  }

  async sendEmailChangeCancelled(data: EmailChangeCancelledData): Promise<void> {
    await this.enqueue(
      data.email,
      'Email Change Cancelled - NotifyKit',
      emailChangeCancelledTemplate(data.email, data.newEmail),
      'email-change-cancelled',
    );
    this.logger.log(`Email change cancelled notification queued for ${data.email}`);
  }

  async sendEmailChangeSuccess(data: EmailChangeSuccessData): Promise<void> {
    await this.enqueue(
      data.email,
      'Email Updated Successfully - NotifyKit',
      emailChangeSuccessTemplate(data.email),
      'email-change-success',
    );
    this.logger.log(`Email change success notification queued for ${data.email}`);
  }

  async sendPaymentFailedEmail(data: PaymentFailedEmailData): Promise<void> {
    await this.enqueue(
      data.email,
      'Payment Failed - Action Required - NotifyKit',
      paymentFailedEmailTemplate(data.name, data.plan, data.amount, data.retryDate),
      'payment-failed',
    );
    this.logger.log(`Payment failed email queued for ${data.email}`);
  }

  async sendDomainProviderAddedEmail(data: DomainProviderAddedEmailData): Promise<void> {
    await this.enqueue(
      data.email,
      `Action needed: publish DNS records for ${data.provider} - NotifyKit`,
      domainProviderAddedTemplate(data.name, data.domain, data.provider, data.dnsRecords),
      'domain-provider-added',
    );
    this.logger.log(`Domain-provider-added email queued for ${data.email} (${data.domain})`);
  }
}
