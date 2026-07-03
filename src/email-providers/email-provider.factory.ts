import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerPlan, EmailProviderType } from '@prisma/client';
import { IEmailProvider } from './email-provider.interface';
import { SendGridService } from './sendgrid/sendgrid.service';
import { ResendService } from './resend/resend.service';
import { PostmarkService } from './postmark/postmark.service';

export interface ProviderConfig {
  provider: EmailProviderType;
  apiKey: string;
  priority: number;
}

export interface ResolvedProvider {
  type: EmailProviderType;
  provider: IEmailProvider;
  apiKey: string;
}

@Injectable()
export class EmailProviderFactory {
  constructor(
    private readonly sendGridService: SendGridService,
    private readonly resendService: ResendService,
    private readonly postmarkService: PostmarkService,
    private readonly configService: ConfigService,
  ) {}

  resolveAll(
    plan: CustomerPlan,
    providers: ProviderConfig[],
  ): ResolvedProvider[] {
    if (plan === CustomerPlan.FREE) {
      const resolved: ResolvedProvider[] = [];
      const sendGridKey = this.configService.get<string>('SENDGRID_API_KEY');
      if (sendGridKey) {
        resolved.push({
          type: EmailProviderType.SENDGRID,
          provider: this.sendGridService,
          apiKey: sendGridKey,
        });
      }
      const resendKey = this.configService.get<string>('RESEND_API_KEY');
      if (resendKey) {
        resolved.push({
          type: EmailProviderType.RESEND,
          provider: this.resendService,
          apiKey: resendKey,
        });
      }
      const postmarkKey = this.configService.get<string>('POSTMARK_API_KEY');
      if (postmarkKey) {
        resolved.push({
          type: EmailProviderType.POSTMARK,
          provider: this.postmarkService,
          apiKey: postmarkKey,
        });
      }
      if (!resolved.length) {
        throw new Error('No shared email provider configured');
      }
      return resolved;
    }

    if (!providers.length) {
      throw new Error(
        'No email provider configured. Please add an API key in settings.',
      );
    }

    return [...providers]
      .sort((a, b) => a.priority - b.priority)
      .map((config) => ({
        type: config.provider,
        provider: this.getProviderService(config.provider),
        apiKey: config.apiKey,
      }));
  }

  resolveOne(
    plan: CustomerPlan,
    providers: ProviderConfig[],
    requested: EmailProviderType,
  ): ResolvedProvider | null {
    return (
      this.resolveAll(plan, providers).find((r) => r.type === requested) ?? null
    );
  }

  private getProviderService(type: EmailProviderType): IEmailProvider {
    switch (type) {
      case EmailProviderType.SENDGRID:
        return this.sendGridService;
      case EmailProviderType.RESEND:
        return this.resendService;
      case EmailProviderType.POSTMARK:
        return this.postmarkService;
      default:
        throw new Error(`Unsupported email provider: ${String(type)}`);
    }
  }
}
