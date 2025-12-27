import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  from?: string;
}

@Injectable()
export class SendGridService {
  private readonly logger = new Logger(SendGridService.name);
  private readonly defaultFromEmail: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    this.defaultFromEmail = this.configService.get<string>(
      'SENDGRID_FROM_EMAIL',
      'noreply@notifyhub.com',
    );

    if (!apiKey) {
      this.logger.warn(
        'SENDGRID_API_KEY not set. Email sending will fail in production.',
      );
    } else {
      sgMail.setApiKey(apiKey);
      this.logger.log('SendGrid initialized successfully');
    }
  }

  /**
   * Send email via SendGrid
   */
  async sendEmail(params: SendEmailParams): Promise<any> {
    const { to, subject, body, from } = params;

    const msg = {
      to,
      from: from || this.defaultFromEmail,
      subject,
      html: body,
    };

    try {
      const [response] = await sgMail.send(msg);

      this.logger.log(
        `Email sent successfully to ${to} - Status: ${response.statusCode}`,
      );

      return {
        statusCode: response.statusCode,
        messageId: response.headers['x-message-id'],
      };
    } catch (error) {
      this.logger.error(`SendGrid error: ${error.message}`);

      if (error.response) {
        const { statusCode, body } = error.response;
        throw new Error(
          `SendGrid API error (${statusCode}): ${JSON.stringify(body)}`,
        );
      }

      throw error;
    }
  }
}
