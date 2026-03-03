import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class PaystackSignatureGuard implements CanActivate {
  private readonly logger = new Logger(PaystackSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const signature = request.headers['x-paystack-signature'] as string;
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');

    if (!signature || !secret || !request.rawBody) {
      throw new UnauthorizedException('Invalid Paystack webhook request');
    }

    const hash = crypto
      .createHmac('sha512', secret)
      .update(request.rawBody)
      .digest('hex');

    const hashBuf = Buffer.from(hash, 'hex');
    const sigBuf = Buffer.from(signature, 'hex');

    if (
      hashBuf.length !== sigBuf.length ||
      !crypto.timingSafeEqual(hashBuf, sigBuf)
    ) {
      this.logger.warn('Paystack signature validation failed');
      throw new UnauthorizedException('Invalid Paystack webhook signature');
    }

    return true;
  }
}
