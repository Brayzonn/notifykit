import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';

@Injectable()
export class StripeSignatureGuard implements CanActivate {
  private readonly logger = new Logger(StripeSignatureGuard.name);
  private readonly stripe: Stripe;

  constructor(private readonly configService: ConfigService) {
    const stripeKey = this.configService.get<string>(
      'STRIPE_SECRET_KEY',
      'placeholder',
    );
    this.stripe = new Stripe(stripeKey);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const signature = request.headers['stripe-signature'] as string;
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    if (!signature || !webhookSecret || !request.rawBody) {
      throw new UnauthorizedException('Invalid Stripe webhook request');
    }

    try {
      this.stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        webhookSecret,
      );
      return true;
    } catch (error) {
      this.logger.warn(`Stripe signature validation failed: ${error.message}`);
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }
  }
}
