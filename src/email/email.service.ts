import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';
import {
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

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');

    if (!apiKey) {
      this.logger.warn('SENDGRID_API_KEY not configured.');
    } else {
      sgMail.setApiKey(apiKey);
    }

    this.fromEmail = this.configService.get<string>(
      'SENDGRID_FROM_EMAIL',
      'noreply@notifyhub.com',
    );
  }

  /**
   * Send OTP verification email
   */
  async sendOtpEmail(data: OtpEmailData): Promise<void> {
    const html = otpEmailTemplate(data.otp, data.expiresInMinutes);

    await sgMail.send({
      to: data.email,
      from: this.fromEmail,
      subject: 'Verify Your Email - NotifyHub',
      html,
    });

    this.logger.log(`OTP email sent to ${data.email}`);
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(data: WelcomeEmailData): Promise<void> {
    const html = welcomeEmailTemplate(data.name);

    await sgMail.send({
      to: data.email,
      from: this.fromEmail,
      subject: 'Welcome to NotifyHub',
      html,
    });

    this.logger.log(`Welcome email sent to ${data.email}`);
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    const html = passwordResetEmailTemplate(resetUrl);

    await sgMail.send({
      to: email,
      from: this.fromEmail,
      subject: 'Reset Your Password - NotifyHub',
      html,
    });

    this.logger.log(`Password reset email sent to ${email}`);
  }

  async sendEmailChangeVerification(
    data: EmailChangeVerificationData,
  ): Promise<void> {
    const html = emailChangeVerificationTemplate(data.name, data.verifyLink);

    await sgMail.send({
      to: data.email,
      from: this.fromEmail,
      subject: 'Verify Your New Email Address - NotifyHub',
      html,
    });

    this.logger.log(`Email change verification sent to ${data.email}`);
  }

  async sendEmailChangeConfirmation(
    data: EmailChangeConfirmationData,
  ): Promise<void> {
    const html = emailChangeConfirmationTemplate(
      data.name,
      data.email,
      data.newEmail,
      data.confirmLink,
      data.cancelLink,
    );

    await sgMail.send({
      to: data.email,
      from: this.fromEmail,
      subject: 'Confirm Email Change Request - NotifyHub',
      html,
    });

    this.logger.log(`Email change confirmation sent to ${data.email}`);
  }

  async sendEmailChangeCancelled(
    data: EmailChangeCancelledData,
  ): Promise<void> {
    const html = emailChangeCancelledTemplate(data.email, data.newEmail);

    await sgMail.send({
      to: data.email,
      from: this.fromEmail,
      subject: 'Email Change Cancelled - NotifyHub',
      html,
    });

    this.logger.log(
      `Email change cancelled notification sent to ${data.email}`,
    );
  }

  async sendEmailChangeSuccess(data: EmailChangeSuccessData): Promise<void> {
    const html = emailChangeSuccessTemplate(data.email);

    await sgMail.send({
      to: data.email,
      from: this.fromEmail,
      subject: 'Email Updated Successfully - NotifyHub',
      html,
    });

    this.logger.log(`Email change success notification sent to ${data.email}`);
  }

  async sendPaymentFailedEmail(data: PaymentFailedEmailData): Promise<void> {
    const html = paymentFailedEmailTemplate(
      data.name,
      data.plan,
      data.amount,
      data.retryDate,
    );

    await sgMail.send({
      to: data.email,
      from: this.fromEmail,
      subject: 'Payment Failed - Action Required - NotifyHub',
      html,
    });

    this.logger.log(`Payment failed email sent to ${data.email}`);
  }
}
