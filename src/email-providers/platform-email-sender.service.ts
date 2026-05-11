import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmailProvider } from './email-provider.interface';
import { ResendService } from './resend/resend.service';
import { SendGridService } from './sendgrid/sendgrid.service';
import { PostmarkService } from './postmark/postmark.service';
import { getErrorMessage } from '@/common/utils/error.util';

interface ResolvedPlatformProvider {
  name: string;
  service: IEmailProvider;
  apiKey: string;
}

export interface PlatformSendParams {
  to: string;
  subject: string;
  html: string;
}

// Priority order is fixed in code — any provider with a configured API key is included.
// To add a new provider: inject its service, add an entry to PROVIDER_REGISTRY below.
const PROVIDER_REGISTRY_KEYS = ['resend', 'sendgrid', 'postmark'] as const;

@Injectable()
export class PlatformEmailSenderService {
  private readonly logger = new Logger(PlatformEmailSenderService.name);
  private readonly providers: ResolvedPlatformProvider[];

  constructor(
    configService: ConfigService,
    resendService: ResendService,
    sendGridService: SendGridService,
    postmarkService: PostmarkService,
  ) {
    const registry: Record<string, { service: IEmailProvider; apiKey: string }> = {
      resend: {
        service: resendService,
        apiKey: configService.get<string>('RESEND_API_KEY', ''),
      },
      sendgrid: {
        service: sendGridService,
        apiKey: configService.get<string>('SENDGRID_API_KEY', ''),
      },
      postmark: {
        service: postmarkService,
        apiKey: configService.get<string>('POSTMARK_API_KEY', ''),
      },
    };

    this.providers = PROVIDER_REGISTRY_KEYS.reduce<ResolvedPlatformProvider[]>((acc, name) => {
      if (registry[name].apiKey) {
        acc.push({ name, ...registry[name] });
      }
      return acc;
    }, []);

    if (this.providers.length === 0) {
      this.logger.error('No platform email providers configured — platform emails will fail');
    } else {
      this.logger.log(
        `Platform email providers: ${this.providers.map((p) => p.name).join(' → ')}`,
      );
    }
  }

  async send(params: PlatformSendParams): Promise<void> {
    const errors: string[] = [];

    for (const { name, service, apiKey } of this.providers) {
      try {
        await service.sendEmail({ to: params.to, subject: params.subject, body: params.html }, apiKey);
        this.logger.log(`Platform email sent to ${params.to} via ${name}`);
        return;
      } catch (err) {
        const msg = getErrorMessage(err);
        this.logger.warn(`Provider "${name}" failed for ${params.to}: ${msg}`);
        errors.push(`${name}: ${msg}`);
      }
    }

    throw new Error(`All platform email providers failed — ${errors.join('; ')}`);
  }
}
