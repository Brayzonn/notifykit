import {
  Controller,
  Post,
  Get,
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
import { PaystackWebhookHandler } from './webhooks/paystack-webhook.handler';
import { PolarWebhookHandler } from './webhooks/polar-webhook.handler';
import { IpRateLimitGuard } from '@/auth/guards/ip-rate-limit.guard';
import { IpRateLimit } from '@/auth/decorators/ip-rate-limit.decorator';
import { PaystackSignatureGuard } from './guards/paystack-signature.guard';

@Controller('payment')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly paystackWebhookHandler: PaystackWebhookHandler,
    private readonly polarWebhookHandler: PolarWebhookHandler,
  ) {}

  @Public()
  @IpRateLimit(300)
  @UseGuards(PaystackSignatureGuard, IpRateLimitGuard)
  @Post('paystack/webhook')
  @HttpCode(HttpStatus.OK)
  async handlePaystackWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing request body');
    }

    if (!signature) {
      throw new BadRequestException('Missing x-paystack-signature header');
    }

    return this.paystackWebhookHandler.handle(req.rawBody, signature);
  }

  @Public()
  @IpRateLimit(300)
  @UseGuards(IpRateLimitGuard)
  @Post('polar/webhook')
  @HttpCode(HttpStatus.OK)
  async handlePolarWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string>,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing request body');
    }
    return this.polarWebhookHandler.handle(req.rawBody, headers);
  }

  @IpRateLimit(60)
  @UseGuards(JwtAuthGuard, IpRateLimitGuard)
  @Get('methods')
  async getPaymentMethods(@User() user: AuthenticatedUser) {
    return this.paymentService.getPaymentMethods(user.id);
  }
}
