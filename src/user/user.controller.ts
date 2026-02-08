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
import { Roles } from '@/common/decorators/roles.decorator';
import { User } from '@/common/decorators/user.decorator';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { Public } from '@/auth/decorators/public.decorator';
import { RequestDomainDto } from './dto/RequestDomain.dto';

@Controller('user')
@UseGuards(JwtAuthGuard, RolesGuard)
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
  @HttpCode(HttpStatus.OK)
  async verifyNewEmail(@Param('token') token: string) {
    return await this.userService.verifyNewEmail(token);
  }

  @Post('email/confirm-old/:token')
  @Public()
  @HttpCode(HttpStatus.OK)
  async confirmOldEmail(@Param('token') token: string) {
    return await this.userService.confirmOldEmail(token);
  }

  @Post('email/cancel/:token')
  @Public()
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
