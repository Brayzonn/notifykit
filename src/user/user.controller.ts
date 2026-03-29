import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { UserService } from './user.service';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  UpdateEmailDto,
  GetJobsDto,
  DeleteAccountDto,
  RegenerateApiKeyDto,
} from '@/user/dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { IpRateLimitGuard } from '@/auth/guards/ip-rate-limit.guard';
import { IpRateLimit } from '@/auth/decorators/ip-rate-limit.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { User } from '@/common/decorators/user.decorator';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { Public } from '@/auth/decorators/public.decorator';
import { RequestDomainDto } from './dto/RequestDomain.dto';

@Controller('user')
@IpRateLimit(120)
@UseGuards(JwtAuthGuard, RolesGuard, IpRateLimitGuard)
@Roles(UserRole.USER)
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * ================================
   * PROFILE ENDPOINTS
   * ================================
   */

  @Get('profile')
  async getProfile(@User() user: AuthenticatedUser) {
    return await this.userService.getUserProfile(user.id);
  }

  @Patch('profile')
  async updateProfile(
    @User() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return await this.userService.updateProfile(user.id, dto);
  }

  /**
   * ================================
   * ACCOUNT MANAGEMENT
   * ================================
   */

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @User() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return await this.userService.changePassword(user.id, dto);
  }

  @Post('email/change-request')
  @HttpCode(HttpStatus.OK)
  async requestEmailChange(
    @User() user: AuthenticatedUser,
    @Body() dto: UpdateEmailDto,
  ) {
    return await this.userService.requestEmailChange(user.id, dto);
  }

  @Post('email/verify-new/:token')
  @Public()
  @IpRateLimit(20)
  @HttpCode(HttpStatus.OK)
  async verifyNewEmail(@Param('token') token: string) {
    return await this.userService.verifyNewEmail(token);
  }

  @Post('email/confirm-old/:token')
  @Public()
  @IpRateLimit(20)
  @HttpCode(HttpStatus.OK)
  async confirmOldEmail(@Param('token') token: string) {
    return await this.userService.confirmOldEmail(token);
  }

  @Post('email/cancel/:token')
  @Public()
  @IpRateLimit(20)
  @HttpCode(HttpStatus.OK)
  async cancelEmailChange(@Param('token') token: string) {
    return await this.userService.cancelEmailChange(token);
  }

  @Delete('account')
  @HttpCode(HttpStatus.OK)
  async deleteAccount(
    @User() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
  ) {
    return await this.userService.deleteAccount(user.id, dto.confirmEmail);
  }

  /**
   * ================================
   * DASHBOARD ENDPOINTS
   * ================================
   */

  @Get('dashboard')
  async getDashboard(
    @User() user: AuthenticatedUser,
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
  ) {
    const validDays = [7, 30, 90].includes(days) ? days : 7;
    return await this.userService.getDashboardSummary(user.id, validDays);
  }

  /**
   * ================================
   * API KEY MANAGEMENT
   * ================================
   */

  @Get('api-key')
  async getApiKey(@User() user: AuthenticatedUser) {
    return await this.userService.getApiKey(user.id);
  }

  @Post('api-key/generate')
  @HttpCode(HttpStatus.OK)
  async regenerateApiKey(
    @User() user: AuthenticatedUser,
    @Body() dto: RegenerateApiKeyDto,
  ) {
    if (!dto.confirmEmail) {
      throw new BadRequestException(
        'Confirmation email required to regenerate API key',
      );
    }
    return await this.userService.regenerateApiKey(
      user.id,
      user.email,
      dto.confirmEmail,
    );
  }

  /**
   * ================================
   * SENDGRID KEY MANAGEMENT
   * ================================
   */

  @Post('sendgrid-key')
  @HttpCode(HttpStatus.OK)
  async saveSendgridKey(
    @User() user: AuthenticatedUser,
    @Body('apiKey') apiKey: string,
  ) {
    if (!apiKey) {
      throw new BadRequestException('SendGrid API key is required');
    }
    return await this.userService.saveCustomerSendgridKey(user.id, apiKey);
  }

  @Get('sendgrid-key')
  async getSendgridKey(@User() user: AuthenticatedUser) {
    return await this.userService.getCustomerSendgridKey(user.id);
  }

  @Delete('sendgrid-key')
  @HttpCode(HttpStatus.OK)
  async removeSendgridKey(@User() user: AuthenticatedUser) {
    return await this.userService.removeCustomerSendgridKey(user.id);
  }

  /**
   * ================================
   * RESEND KEY MANAGEMENT
   * ================================
   */

  @Post('resend-key')
  @HttpCode(HttpStatus.OK)
  async saveResendKey(
    @User() user: AuthenticatedUser,
    @Body('apiKey') apiKey: string,
  ) {
    if (!apiKey) {
      throw new BadRequestException('Resend API key is required');
    }
    return await this.userService.saveCustomerResendKey(user.id, apiKey);
  }

  @Get('resend-key')
  async getResendKey(@User() user: AuthenticatedUser) {
    return await this.userService.getCustomerResendKey(user.id);
  }

  @Delete('resend-key')
  @HttpCode(HttpStatus.OK)
  async removeResendKey(@User() user: AuthenticatedUser) {
    return await this.userService.removeCustomerResendKey(user.id);
  }

  @Get('email-provider')
  async getEmailProvider(@User() user: AuthenticatedUser) {
    return await this.userService.getEmailProviderStatus(user.id);
  }

  @Patch('email-provider/:provider/priority')
  @HttpCode(HttpStatus.OK)
  async updateEmailProviderPriority(
    @User() user: AuthenticatedUser,
    @Param('provider') provider: string,
    @Body('priority') priority: number,
  ) {
    if (priority == null || !Number.isInteger(priority) || priority < 1) {
      throw new BadRequestException('priority must be a positive integer');
    }
    return await this.userService.updateEmailProviderPriority(user.id, provider, priority);
  }

  /**
   * ================================
   * RESEND WEBHOOK KEY MANAGEMENT
   * ================================
   */

  @Post('resend-webhook-key')
  @HttpCode(HttpStatus.OK)
  async saveResendWebhookSecret(
    @User() user: AuthenticatedUser,
    @Body('secret') secret: string,
  ) {
    if (!secret) {
      throw new BadRequestException('secret is required');
    }
    return await this.userService.saveResendWebhookSecret(user.id, secret);
  }

  @Get('resend-webhook-key')
  async getResendWebhookSecret(@User() user: AuthenticatedUser) {
    return await this.userService.getResendWebhookSecret(user.id);
  }

  @Delete('resend-webhook-key')
  @HttpCode(HttpStatus.OK)
  async removeResendWebhookSecret(@User() user: AuthenticatedUser) {
    return await this.userService.removeResendWebhookSecret(user.id);
  }

  /**
   * ================================
   * SENDGRID WEBHOOK KEY MANAGEMENT
   * ================================
   */

  @Post('sendgrid-webhook-key')
  @HttpCode(HttpStatus.OK)
  async saveSendgridWebhookKey(
    @User() user: AuthenticatedUser,
    @Body('webhookKey') webhookKey: string,
  ) {
    if (!webhookKey) {
      throw new BadRequestException('webhookKey is required');
    }
    return await this.userService.saveSendgridWebhookKey(user.id, webhookKey);
  }

  @Get('sendgrid-webhook-key')
  async getSendgridWebhookKey(@User() user: AuthenticatedUser) {
    return await this.userService.getSendgridWebhookKey(user.id);
  }

  @Delete('sendgrid-webhook-key')
  @HttpCode(HttpStatus.OK)
  async removeSendgridWebhookKey(@User() user: AuthenticatedUser) {
    return await this.userService.removeSendgridWebhookKey(user.id);
  }

  /**
   * ================================
   * USAGE
   * ================================
   */

  @Get('usage')
  async getUsage(@User() user: AuthenticatedUser) {
    return await this.userService.getUsageStats(user.id);
  }

  /**
   * ================================
   * JOBS/NOTIFICATIONS HISTORY
   * ================================
   */

  @Get('jobs')
  async getJobs(@User() user: AuthenticatedUser, @Query() query: GetJobsDto) {
    return await this.userService.getJobsHistory(
      user.id,
      query.page,
      query.limit,
      query.status,
      query.type,
    );
  }

  @Get('jobs/:id')
  async getJobDetails(
    @User() user: AuthenticatedUser,
    @Param('id') jobId: string,
  ) {
    return await this.userService.getJobDetails(user.id, jobId);
  }

  @Post('jobs/:id/retry')
  async retryJob(@User() user: AuthenticatedUser, @Param('id') jobId: string) {
    return await this.userService.retryJob(user.id, jobId);
  }

  /**
   * ================================
   * DOMAIN VERIFICATION
   * ================================
   */

  @Post('domain/request')
  async requestDomainVerification(
    @User() user: AuthenticatedUser,
    @Body() dto: RequestDomainDto,
  ) {
    return await this.userService.requestDomainVerification(
      user.id,
      dto.domain,
    );
  }

  @Post('domain/verify')
  @HttpCode(HttpStatus.OK)
  async checkDomainVerification(@User() user: AuthenticatedUser) {
    return await this.userService.checkDomainVerification(user.id);
  }

  @Get('domain/status')
  async getDomainStatus(@User() user: AuthenticatedUser) {
    return await this.userService.getDomainStatus(user.id);
  }

  @Delete('domain')
  @HttpCode(HttpStatus.OK)
  async removeDomain(@User() user: AuthenticatedUser) {
    return await this.userService.removeDomain(user.id);
  }
}
