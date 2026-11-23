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
import { BrevoSignatureGuard } from './guards/brevo-signature.guard';
import { BrevoPlatformSignatureGuard } from './guards/brevo-platform-signature.guard';
import { BrevoEventsService } from './brevo-events.service';

@Controller('webhooks')
export class BrevoEventsController {
  constructor(private readonly brevoEventsService: BrevoEventsService) {}

  @Public()
  @IpRateLimit(300)
  @UseGuards(BrevoPlatformSignatureGuard, IpRateLimitGuard)
  @Post('brevo')
  @HttpCode(HttpStatus.OK)
  async handleBrevoPlatformEvent(@Body() body: any) {
    await this.brevoEventsService.processEvents(undefined, body);
    return { received: true };
  }

  @Public()
  @IpRateLimit(300)
  @UseGuards(BrevoSignatureGuard, IpRateLimitGuard)
  @Post('brevo/:customerId')
  @HttpCode(HttpStatus.OK)
  async handleBrevoEvent(
    @Param('customerId') customerId: string,
    @Body() body: any,
  ) {
    await this.brevoEventsService.processEvents(customerId, body);
    return { received: true };
  }
}
