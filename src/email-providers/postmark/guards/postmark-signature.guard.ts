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

export const isValidPostmarkBasicAuth = (
  request: Request,
  secret: string,
): boolean => {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    throw new UnauthorizedException('Missing Postmark webhook credentials');
  }

  let provided: string;
  try {
    const decoded = Buffer.from(authHeader.substring(6), 'base64').toString(
      'utf8',
    );
    const [, password = ''] = decoded.split(':');
    provided = password;
  } catch {
    throw new UnauthorizedException('Malformed Postmark webhook credentials');
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

@Injectable()
export class PostmarkSignatureGuard implements CanActivate {
  private readonly logger = new Logger(PostmarkSignatureGuard.name);

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
          provider: EmailProviderType.POSTMARK,
        },
      },
      select: { webhookSecret: true },
    });

    if (!providerRecord?.webhookSecret) {
      throw new NotFoundException();
    }

    if (!isValidPostmarkBasicAuth(request, providerRecord.webhookSecret)) {
      this.logger.warn(
        `Postmark signature validation failed for ${customerId}`,
      );
      throw new UnauthorizedException('Invalid Postmark webhook credentials');
    }

    return true;
  }
}
