import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailProviderType } from '@/generated/prisma/client';
import * as crypto from 'crypto';

const extractBrevoCredential = (authHeader: string): string => {
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.substring(6), 'base64').toString(
      'utf8',
    );
    const separator = decoded.indexOf(':');
    return separator === -1 ? '' : decoded.substring(separator + 1);
  }

  throw new UnauthorizedException('Unsupported Brevo webhook credentials');
};

export const isValidBrevoWebhookAuth = (
  request: Request,
  secret: string,
): boolean => {
  const authHeader = request.headers['authorization'];
  if (!authHeader) {
    throw new UnauthorizedException('Missing Brevo webhook credentials');
  }

  const a = Buffer.from(extractBrevoCredential(authHeader));
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

@Injectable()
export class BrevoSignatureGuard implements CanActivate {
  private readonly logger = new Logger(BrevoSignatureGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const customerId = request.params['customerId'] as string;

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });

    if (!customer) {
      throw new UnauthorizedException('Unknown customer');
    }

    const providerRecord = await this.prisma.customerEmailProvider.findUnique({
      where: {
        customerId_provider: {
          customerId: customer.id,
          provider: EmailProviderType.BREVO,
        },
      },
      select: { webhookSecret: true },
    });

    if (!providerRecord?.webhookSecret) {
      throw new NotFoundException();
    }

    if (!isValidBrevoWebhookAuth(request, providerRecord.webhookSecret)) {
      this.logger.warn(`Brevo webhook auth failed for ${customerId}`);
      throw new UnauthorizedException('Invalid Brevo webhook credentials');
    }

    return true;
  }
}
