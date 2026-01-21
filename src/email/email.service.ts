import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';
import {
  OtpEmailData,
  WelcomeEmailData,
} from '@/email/interfaces/email.interface';
import { otpEmailTemplate } from '@/email/templates/otp.template';
import { welcomeEmailTemplate } from '@/email/templates/welcome.template';
import { passwordResetEmailTemplate } from '@/email/templates/password-reset.template';

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
}
