import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerPlan, EmailProviderType } from '@prisma/client';
import { IEmailProvider } from './email-provider.interface';
import { SendGridService } from '@/sendgrid/sendgrid.service';
import { ResendService } from './resend.service';

export interface ProviderConfig {
  provider: EmailProviderType;
  apiKey: string;
  priority: number;
}

export interface ResolvedProvider {
  provider: IEmailProvider;
  apiKey: string;
}

@Injectable()
export class EmailProviderFactory {
  constructor(
    private readonly sendGridService: SendGridService,
    private readonly resendService: ResendService,
    private readonly configService: ConfigService,
  ) {}

  resolveAll(plan: CustomerPlan, providers: ProviderConfig[]): ResolvedProvider[] {
    // FREE plan always uses the shared SendGrid key — ignore customer providers
    if (plan === CustomerPlan.FREE) {
      const sharedKey = this.configService.get<string>('SENDGRID_API_KEY');
      if (!sharedKey) {
        throw new Error('No shared SendGrid API key configured');
      }
      return [{ provider: this.sendGridService, apiKey: sharedKey }];
    }

    if (!providers.length) {
      throw new Error(
        'No email provider configured. Please add an API key in settings.',
      );
    }

    return [...providers]
      .sort((a, b) => a.priority - b.priority)
      .map((config) => ({
        provider: this.getProviderService(config.provider),
        apiKey: config.apiKey,
      }));
  }

  private getProviderService(type: EmailProviderType): IEmailProvider {
    switch (type) {
      case EmailProviderType.SENDGRID:
        return this.sendGridService;
      case EmailProviderType.RESEND:
        return this.resendService;
      default:
        throw new Error(`Unsupported email provider: ${type}`);
    }
  }
}
