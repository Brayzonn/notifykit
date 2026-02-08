import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  BadRequestException,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { Public } from '@/auth/decorators/public.decorator';
import { User } from '@/common/decorators/user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { StripeWebhookHandler } from './webhooks/stripe-webhook.handler';

@Controller('payment')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly stripeWebhookHandler: StripeWebhookHandler,
  ) {}

  @Public()
  @Post('stripe/webhook')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing request body');
    }
    return this.stripeWebhookHandler.handle(req.rawBody, signature);
  }

  @UseGuards(JwtAuthGuard)
  @Get('methods')
  async getPaymentMethods(@User() user: AuthenticatedUser) {
    return this.paymentService.getPaymentMethods(user.id);
  }
}
