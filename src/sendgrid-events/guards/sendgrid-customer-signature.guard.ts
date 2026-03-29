import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { EventWebhook } from '@sendgrid/eventwebhook';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailProviderType } from '@prisma/client';

@Injectable()
export class SendgridCustomerSignatureGuard implements CanActivate {
  private readonly logger = new Logger(SendgridCustomerSignatureGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const customerId = request.params['customerId'] as string;

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });

    if (!customer) {
      throw new UnauthorizedException('Unknown customer');
    }

    const providerRecord = await this.prisma.customerEmailProvider.findUnique({
      where: { customerId_provider: { customerId: customer.id, provider: EmailProviderType.SENDGRID } },
      select: { webhookSecret: true },
    });

    const webhookKey = providerRecord?.webhookSecret ?? null;

    if (!webhookKey) {
      throw new NotFoundException();
    }

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
      const publicKey = ew.convertPublicKeyToECDSA(webhookKey);
      const valid = ew.verifySignature(
        publicKey,
        request.rawBody,
        signature,
        timestamp,
      );

      if (!valid) {
        throw new Error('Signature mismatch');
      }

      return true;
    } catch (error) {
      this.logger.warn(
        `SendGrid customer signature validation failed for ${customerId}: ${error.message}`,
      );
      throw new UnauthorizedException('Invalid SendGrid webhook signature');
    }
  }
}
