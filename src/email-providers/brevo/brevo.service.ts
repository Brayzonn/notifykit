import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { IEmailProvider, SendEmailParams } from '../email-provider.interface';
import { ProviderError } from '../provider-error';

export const BREVO_JOB_TAG_PREFIX = 'job_id:';

@Injectable()
export class BrevoService implements IEmailProvider {
  private readonly logger = new Logger(BrevoService.name);
  private readonly defaultFromEmail: string;
  private readonly endpoint = 'https://api.brevo.com/v3/smtp/email';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.defaultFromEmail = this.configService.get<string>(
      'BREVO_FROM_EMAIL',
      'noreply@notifykit.dev',
    );
  }

  async sendEmail(params: SendEmailParams, apiKey: string): Promise<any> {
    const { to, subject, body, from, jobId } = params;

    if (!apiKey) {
      throw new Error('No Brevo API key available');
    }

    const payload: Record<string, unknown> = {
      sender: { email: from ?? this.defaultFromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: body,
      ...(jobId ? { tags: [`${BREVO_JOB_TAG_PREFIX}${jobId}`] } : {}),
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<{ messageId?: string }>(this.endpoint, payload, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'api-key': apiKey,
          },
        }),
      );

      this.logger.log(`Email sent successfully to ${to}`);
      return {
        statusCode: response.status,
        message: 'Email accepted for delivery',
        to,
        subject,
        messageId: response.data?.messageId,
      };
    } catch (error) {
      const providerError = ProviderError.fromHttpError(
        `Brevo API error: ${this.describeError(error)}`,
        error,
      );
      this.logger.error('Brevo error:', providerError.message);
      throw providerError;
    }
  }

  private describeError(error: unknown): string {
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    if (data && typeof data === 'object' && 'message' in data) {
      return String((data as { message: unknown }).message);
    }
    return error instanceof Error ? error.message : String(error);
  }
}
