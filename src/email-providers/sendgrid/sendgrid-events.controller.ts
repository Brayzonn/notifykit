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
import { SendgridSignatureGuard } from './guards/sendgrid-signature.guard';
import { SendgridCustomerSignatureGuard } from './guards/sendgrid-customer-signature.guard';
import { SendgridEventsService } from './sendgrid-events.service';

@Controller('webhooks')
export class SendgridEventsController {
  constructor(private readonly sendgridEventsService: SendgridEventsService) {}

  @Public()
  @IpRateLimit(300)
  @UseGuards(SendgridSignatureGuard, IpRateLimitGuard)
  @Post('sendgrid')
  @HttpCode(HttpStatus.OK)
  async handleSendgridEvents(@Body() events: any[]) {
    await this.sendgridEventsService.processEvents(events);
    return { received: true };
  }

  @Public()
  @IpRateLimit(300)
  @UseGuards(SendgridCustomerSignatureGuard, IpRateLimitGuard)
  @Post('sendgrid/:customerId')
  @HttpCode(HttpStatus.OK)
  async handleSendgridCustomerEvents(
    @Param('customerId') customerId: string,
    @Body() events: any[],
  ) {
    await this.sendgridEventsService.processEvents(events, customerId);
    return { received: true };
  }
}
