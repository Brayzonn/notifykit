import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { isValidBrevoWebhookAuth } from './brevo-signature.guard';

@Injectable()
export class BrevoPlatformSignatureGuard implements CanActivate {
  private readonly logger = new Logger(BrevoPlatformSignatureGuard.name);
  private readonly secret: string | undefined;

  constructor(configService: ConfigService) {
    this.secret = configService.get<string>('BREVO_WEBHOOK_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.secret) {
      throw new NotFoundException();
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (!isValidBrevoWebhookAuth(request, this.secret)) {
      this.logger.warn('Platform Brevo webhook auth failed');
      throw new UnauthorizedException('Invalid Brevo webhook credentials');
    }

    return true;
  }
}
