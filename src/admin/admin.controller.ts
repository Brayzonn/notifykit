import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import {
  QueryUsersDto,
  UpdateUserDto,
  QueryCustomersDto,
  UpdateCustomerPlanDto,
  ResetCustomerUsageDto,
  QueryJobsDto,
} from './dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * ================================
   * USER MANAGEMENT ENDPOINTS
   * ================================
   */

  @Get('users')
  @ApiOperation({ summary: 'Get all users with pagination and filters' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of users',
  })
  async getUsers(@Query() query: QueryUsersDto) {
    return await this.adminService.getUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user by ID with full details' })
  @ApiParam({ name: 'id', description: 'User ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Returns user details with customer and tokens',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserById(@Param('id') id: string) {
    return await this.adminService.getUserById(id);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user details' })
  @ApiParam({ name: 'id', description: 'User ID (UUID)' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return await this.adminService.updateUser(id, dto);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete user (sets deletedAt timestamp)' })
  @ApiParam({ name: 'id', description: 'User ID (UUID)' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 400, description: 'User is already deleted' })
  async deleteUser(@Param('id') id: string) {
    return await this.adminService.deleteUser(id);
  }

  /**
   * ================================
   * CUSTOMER MANAGEMENT ENDPOINTS
   * ================================
   */

  @Get('customers')
  @ApiOperation({ summary: 'Get all customers with pagination and filters' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of customers',
  })
  async getCustomers(@Query() query: QueryCustomersDto) {
    return await this.adminService.getCustomers(query);
  }

  @Get('customers/:id')
  @ApiOperation({
    summary: 'Get customer by ID with jobs summary and statistics',
  })
  @ApiParam({ name: 'id', description: 'Customer ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Returns customer details with jobs summary',
  })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async getCustomerById(@Param('id') id: string) {
    return await this.adminService.getCustomerById(id);
  }

  @Patch('customers/:id/plan')
  @ApiOperation({ summary: 'Update customer plan and monthly limit' })
  @ApiParam({ name: 'id', description: 'Customer ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Customer plan updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async updateCustomerPlan(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerPlanDto,
  ) {
    return await this.adminService.updateCustomerPlan(id, dto);
  }

  @Patch('customers/:id/usage-reset')
  @ApiOperation({
    summary: 'Reset customer usage count and extend reset date',
  })
  @ApiParam({ name: 'id', description: 'Customer ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Usage reset successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async resetCustomerUsage(
    @Param('id') id: string,
    @Body() dto: ResetCustomerUsageDto,
  ) {
    return await this.adminService.resetCustomerUsage(id, dto);
  }

  /**
   * ================================
   * JOB MANAGEMENT ENDPOINTS
   * ================================
   */

  @Get('jobs')
  @ApiOperation({ summary: 'Get all jobs with pagination and filters' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of jobs',
  })
  async getJobs(@Query() query: QueryJobsDto) {
    return await this.adminService.getJobs(query);
  }

  @Delete('jobs/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hard delete job (permanent deletion)' })
  @ApiParam({ name: 'id', description: 'Job ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Job deleted successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async deleteJob(@Param('id') id: string) {
    return await this.adminService.deleteJob(id);
  }

  /**
   * ================================
   * STATISTICS ENDPOINTS
   * ================================
   */

  @Get('stats')
  @ApiOperation({
    summary: 'Get system-wide statistics (users, customers, jobs)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns aggregate statistics',
  })
  async getStats() {
    return await this.adminService.getStats();
  }
}
