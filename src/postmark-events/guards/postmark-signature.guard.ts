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
import { EmailProviderType } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * Postmark does not natively HMAC-sign webhooks. The recommended pattern is
 * HTTP Basic Auth credentials embedded in the webhook URL, where the password
 * portion is a shared secret stored on the customer's email-provider record.
 *
 * Customers paste the secret as the Basic Auth password when configuring the
 * webhook in Postmark; we compare it (constant-time) against the stored value.
 */
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

    const expected = providerRecord.webhookSecret;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.logger.warn(
        `Postmark signature validation failed for ${customerId}`,
      );
      throw new UnauthorizedException('Invalid Postmark webhook credentials');
    }

    return true;
  }
}
