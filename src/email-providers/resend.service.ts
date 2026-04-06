import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { IEmailProvider, SendEmailParams } from './email-provider.interface';

@Injectable()
export class ResendService implements IEmailProvider {
  private readonly logger = new Logger(ResendService.name);
  private readonly defaultFromEmail: string;

  constructor(private readonly configService: ConfigService) {
    this.defaultFromEmail = this.configService.get<string>(
      'RESEND_FROM_EMAIL',
      'noreply@notifykit.dev',
    );
  }

  async sendEmail(params: SendEmailParams, apiKey: string): Promise<any> {
    const { to, subject, body, from, jobId } = params;

    if (!apiKey) {
      throw new Error('No Resend API key available');
    }

    const resend = new Resend(apiKey);

    try {
      const { data, error } = await resend.emails.send({
        from: from ?? this.defaultFromEmail,
        to,
        subject,
        html: body,
        ...(jobId ? { tags: [{ name: 'job_id', value: jobId }] } : {}),
      });

      if (error) {
        throw new Error(`Resend API error: ${JSON.stringify(error)}`);
      }

      this.logger.log(`Email sent successfully to ${to}`);
      return {
        statusCode: 200,
        message: 'Email accepted for delivery',
        to,
        subject,
        messageId: data?.id,
      };
    } catch (error) {
      this.logger.error('Resend error:', error.message);
      throw error;
    }
  }
}
