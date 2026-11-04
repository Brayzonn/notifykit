import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { getErrorMessage } from '@/common/utils/error.util';
import { verifyResendSignature } from './resend-signature.guard';

@Injectable()
export class ResendPlatformSignatureGuard implements CanActivate {
  private readonly logger = new Logger(ResendPlatformSignatureGuard.name);
  private readonly secret: string | undefined;

  constructor(configService: ConfigService) {
    this.secret = configService.get<string>('RESEND_WEBHOOK_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.secret) {
      throw new NotFoundException();
    }

    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    try {
      verifyResendSignature(request, this.secret);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn(
        `Platform Resend signature validation failed: ${getErrorMessage(error)}`,
      );
      throw new UnauthorizedException('Invalid Resend webhook signature');
    }
  }
}
