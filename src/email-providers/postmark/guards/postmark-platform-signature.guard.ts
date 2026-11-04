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
import { isValidPostmarkBasicAuth } from './postmark-signature.guard';

@Injectable()
export class PostmarkPlatformSignatureGuard implements CanActivate {
  private readonly logger = new Logger(PostmarkPlatformSignatureGuard.name);
  private readonly secret: string | undefined;

  constructor(configService: ConfigService) {
    this.secret = configService.get<string>('POSTMARK_WEBHOOK_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.secret) {
      throw new NotFoundException();
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (!isValidPostmarkBasicAuth(request, this.secret)) {
      this.logger.warn('Platform Postmark signature validation failed');
      throw new UnauthorizedException('Invalid Postmark webhook credentials');
    }

    return true;
  }
}
