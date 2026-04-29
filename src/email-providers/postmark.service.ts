import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { IEmailProvider, SendEmailParams } from './email-provider.interface';

@Injectable()
export class PostmarkService implements IEmailProvider {
  private readonly logger = new Logger(PostmarkService.name);
  private readonly defaultFromEmail: string;
  private readonly endpoint = 'https://api.postmarkapp.com/email';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.defaultFromEmail = this.configService.get<string>(
      'POSTMARK_FROM_EMAIL',
      'noreply@notifykit.dev',
    );
  }

  async sendEmail(params: SendEmailParams, apiKey: string): Promise<any> {
    const { to, subject, body, from, jobId } = params;

    if (!apiKey) {
      throw new Error('No Postmark server token available');
    }

    const payload: Record<string, unknown> = {
      From: from ?? this.defaultFromEmail,
      To: to,
      Subject: subject,
      HtmlBody: body,
      MessageStream: this.configService.get<string>(
        'POSTMARK_MESSAGE_STREAM',
        'outbound',
      ),
      ...(jobId ? { Metadata: { job_id: jobId } } : {}),
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(this.endpoint, payload, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': apiKey,
          },
        }),
      );

      this.logger.log(`Email sent successfully to ${to}`);
      return {
        statusCode: response.status,
        message: response.data?.Message ?? 'Email accepted for delivery',
        to,
        subject,
        messageId: response.data?.MessageID,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Postmark error:', message);
      throw error;
    }
  }
}
