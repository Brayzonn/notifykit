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
} from '@nestjs/common';
import { UserService } from './user.service';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  UpdateEmailDto,
  GetJobsDto,
  DeleteAccountDto,
} from '@/user/dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { User } from '@/common/decorators/user.decorator';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { Public } from '@/auth/decorators/public.decorator';

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
  async getDashboard(@User() user: AuthenticatedUser) {
    return await this.userService.getDashboardSummary(user.id);
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

  @Post('api-key/regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerateApiKey(
    @User() user: AuthenticatedUser,
    @Body('confirm') confirm: boolean,
  ) {
    if (!confirm) {
      throw new BadRequestException(
        'Confirmation required to regenerate API key',
      );
    }
    return await this.userService.regenerateApiKey(user.id);
  }

  /**
   * ================================
   * USAGE & BILLING
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
    );
  }

  @Get('jobs/:id')
  async getJobDetails(
    @User() user: AuthenticatedUser,
    @Param('id') jobId: string,
  ) {
    return await this.userService.getJobDetails(user.id, jobId);
  }
}
