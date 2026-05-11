import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Public } from '@/auth/decorators/public.decorator';
import { IpRateLimitGuard } from '@/auth/guards/ip-rate-limit.guard';
import { IpRateLimit } from '@/auth/decorators/ip-rate-limit.decorator';
import { ResendSignatureGuard } from './guards/resend-signature.guard';
import { ResendEventsService } from './resend-events.service';

@Controller('webhooks')
export class ResendEventsController {
  constructor(private readonly resendEventsService: ResendEventsService) {}

  @Public()
  @IpRateLimit(300)
  @UseGuards(ResendSignatureGuard, IpRateLimitGuard)
  @Post('resend/:customerId')
  @HttpCode(HttpStatus.OK)
  async handleResendEvent(
    @Param('customerId') _customerId: string,
    @Body() event: any,
  ) {
    await this.resendEventsService.processEvent(event);
    return { received: true };
  }
}
