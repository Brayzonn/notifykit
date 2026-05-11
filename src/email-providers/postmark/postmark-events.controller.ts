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
import { PostmarkSignatureGuard } from './guards/postmark-signature.guard';
import { PostmarkEventsService } from './postmark-events.service';

@Controller('webhooks')
export class PostmarkEventsController {
  constructor(private readonly postmarkEventsService: PostmarkEventsService) {}

  @Public()
  @IpRateLimit(300)
  @UseGuards(PostmarkSignatureGuard, IpRateLimitGuard)
  @Post('postmark/:customerId')
  @HttpCode(HttpStatus.OK)
  async handlePostmarkEvent(
    @Param('customerId') _customerId: string,
    @Body() event: any,
  ) {
    await this.postmarkEventsService.processEvent(event);
    return { received: true };
  }
}
