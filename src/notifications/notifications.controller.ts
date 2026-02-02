import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsService } from '@/notifications/notifications.service';
import { ApiKeyGuard } from '@/auth/guards/api-key.guard';
import { CustomerRateLimitGuard } from '@/auth/guards/customer-rate-limit.guard';
import { QuotaGuard } from '@/auth/guards/api-quota.guard';
import {
  CurrentCustomer,
  AuthenticatedCustomer,
} from '@/auth/decorators/current-customer.decorator';
import { SendEmailDto } from '@/notifications/dto/send-email.dto';
import { SendWebhookDto } from '@/notifications/dto/send-webhook.dto';
import { Public } from '@/auth/decorators/public.decorator';

@Public()
@Controller('notifications')
@UseGuards(ApiKeyGuard, CustomerRateLimitGuard, QuotaGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('email')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendEmail(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: SendEmailDto,
  ) {
    return this.notificationsService.sendEmail(customer.id, dto);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendWebhook(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: SendWebhookDto,
  ) {
    return this.notificationsService.sendWebhook(customer.id, dto);
  }

  @Get('jobs/:id')
  async getJobStatus(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') jobId: string,
  ) {
    const job = await this.notificationsService.getJobStatus(
      customer.id,
      jobId,
    );

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }

  @Get('jobs')
  async listJobs(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: 'email' | 'webhook',
    @Query('status') status?: 'pending' | 'processing' | 'completed' | 'failed',
  ) {
    return this.notificationsService.listJobs(customer.id, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      type,
      status,
    });
  }

  @Post('jobs/:id/retry')
  async retryJob(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') jobId: string,
  ) {
    const result = await this.notificationsService.retryJob(customer.id, jobId);

    if (!result) {
      throw new NotFoundException(
        'Job not found or cannot be retried (must be in failed status)',
      );
    }

    return result;
  }
}
