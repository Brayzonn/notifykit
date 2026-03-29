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
import { Webhook } from 'svix';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailProviderType } from '@prisma/client';

@Injectable()
export class ResendSignatureGuard implements CanActivate {
  private readonly logger = new Logger(ResendSignatureGuard.name);

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
      where: { customerId_provider: { customerId: customer.id, provider: EmailProviderType.RESEND } },
      select: { webhookSecret: true },
    });

    if (!providerRecord?.webhookSecret) {
      throw new NotFoundException();
    }

    const svixId = request.headers['svix-id'] as string;
    const svixTimestamp = request.headers['svix-timestamp'] as string;
    const svixSignature = request.headers['svix-signature'] as string;

    if (!svixId || !svixTimestamp || !svixSignature || !request.rawBody) {
      throw new UnauthorizedException('Missing Resend webhook headers');
    }

    try {
      const wh = new Webhook(providerRecord.webhookSecret);
      wh.verify(request.rawBody, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Resend signature validation failed for ${customerId}: ${error.message}`,
      );
      throw new UnauthorizedException('Invalid Resend webhook signature');
    }
  }
}
