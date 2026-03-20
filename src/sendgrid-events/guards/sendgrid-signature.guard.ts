import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { EventWebhook } from '@sendgrid/eventwebhook';

@Injectable()
export class SendgridSignatureGuard implements CanActivate {
  private readonly logger = new Logger(SendgridSignatureGuard.name);
  private readonly verificationKey: string | undefined;
  private readonly isProd: boolean;

  constructor(private readonly configService: ConfigService) {
    this.verificationKey = this.configService.get<string>(
      'SENDGRID_WEBHOOK_VERIFICATION_KEY',
    );
    this.isProd = this.configService.get<string>('NODE_ENV') === 'production';
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.verificationKey) {
      if (this.isProd) {
        this.logger.error(
          'SENDGRID_WEBHOOK_VERIFICATION_KEY is not set in production',
        );
        throw new InternalServerErrorException(
          'Webhook verification is not configured',
        );
      }
      this.logger.warn(
        'SENDGRID_WEBHOOK_VERIFICATION_KEY not set — skipping signature check in development',
      );
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const signature = request.headers[
      'x-twilio-email-event-webhook-signature'
    ] as string;
    const timestamp = request.headers[
      'x-twilio-email-event-webhook-timestamp'
    ] as string;

    if (!signature || !timestamp || !request.rawBody) {
      throw new UnauthorizedException('Missing SendGrid webhook headers');
    }

    try {
      const ew = new EventWebhook();
      const publicKey = ew.convertPublicKeyToECDSA(this.verificationKey);
      const valid = ew.verifySignature(publicKey, request.rawBody, signature, timestamp);

      if (!valid) {
        throw new Error('Signature mismatch');
      }

      return true;
    } catch (error) {
      this.logger.warn(`SendGrid signature validation failed: ${error.message}`);
      throw new UnauthorizedException('Invalid SendGrid webhook signature');
    }
  }
}
