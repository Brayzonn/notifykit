import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CustomerPlan } from '@prisma/client';

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
    this.defaultFromEmail = this.configService.get<string>(
      'SENDGRID_FROM_EMAIL',
      'noreply@notifykit.dev',
    );
  }

  async sendEmail(
    params: SendEmailParams,
    apiKey?: string,
    plan?: CustomerPlan,
  ): Promise<any> {
    const { to, subject, body, from } = params;

    const isPaidPlan = plan && plan !== CustomerPlan.FREE;
    if (isPaidPlan && !apiKey) {
      throw new Error(
        'SendGrid API key required for paid plans. Please add your SendGrid API key in settings.',
      );
    }

    const key = apiKey ?? this.configService.get<string>('SENDGRID_API_KEY');

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
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Email sent successfully to ${to}`);
      return { statusCode: response.status };
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
