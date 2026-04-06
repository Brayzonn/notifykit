import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IEmailProvider, SendEmailParams } from '@/email-providers/email-provider.interface';

@Injectable()
export class SendGridService implements IEmailProvider {
  private readonly logger = new Logger(SendGridService.name);
  private readonly defaultFromEmail: string;

  constructor(private configService: ConfigService) {
    this.defaultFromEmail = this.configService.get<string>(
      'SENDGRID_FROM_EMAIL',
      'noreply@notifykit.dev',
    );
  }

  async sendEmail(params: SendEmailParams, apiKey: string): Promise<any> {
    const { to, subject, body, from, jobId } = params;

    const key = apiKey;

    if (!key) {
      throw new Error('No SendGrid API key available');
    }

    try {
      const response = await axios.post(
        'https://api.sendgrid.com/v3/mail/send',
        {
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from || this.defaultFromEmail },
          subject,
          content: [{ type: 'text/html', value: body }],
          tracking_settings: {
            click_tracking: { enable: false },
          },
          ...(jobId ? { custom_args: { job_id: jobId } } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Email sent successfully to ${to}`);
      return {
        statusCode: response.status,
        message: 'Email accepted for delivery',
        to,
        subject,
      };
    } catch (error) {
      this.logger.error(
        'SendGrid error:',
        error.response?.data || error.message,
      );
      throw new Error(
        `SendGrid API error: ${JSON.stringify(error.response?.data)}`,
      );
    }
  }
}
