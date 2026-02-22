import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  QueryUsersDto,
  UpdateUserDto,
  QueryCustomersDto,
  UpdateCustomerPlanDto,
  ResetCustomerUsageDto,
  QueryJobsDto,
} from './dto';
import { CustomerPlan } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * ================================
   * USER MANAGEMENT
   * ================================
   */

  async getUsers(query: QueryUsersDto) {
    const { page = 1, limit = 20, role, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          provider: true,
          emailVerified: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        avatar: true,
        role: true,
        provider: true,
        providerId: true,
        emailVerified: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        customer: {
          select: {
            id: true,
            plan: true,
            monthlyLimit: true,
            usageCount: true,
            isActive: true,
            subscriptionStatus: true,
          },
        },
        refreshTokens: {
          select: {
            id: true,
            expiresAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateUser(userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        updatedAt: true,
      },
    });

    this.logger.log(`Admin updated user ${userId}: ${JSON.stringify(dto)}`);

    return updated;
  }

  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deletedAt) {
      throw new BadRequestException('User is already deleted');
    }

    const deleted = await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
      select: {
        id: true,
        email: true,
        deletedAt: true,
      },
    });

    this.logger.warn(`Admin soft-deleted user ${userId} (${user.email})`);

    return {
      message: 'User deleted successfully',
      user: deleted,
    };
  }

  /**
   * ================================
   * CUSTOMER MANAGEMENT
   * ================================
   */

  async getCustomers(query: QueryCustomersDto) {
    const { page = 1, limit = 20, plan, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (plan) {
      where.plan = plan;
    }

    if (search) {
      where.email = { contains: search, mode: 'insensitive' };
    }

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          plan: true,
          monthlyLimit: true,
          usageCount: true,
          usageResetAt: true,
          isActive: true,
          subscriptionStatus: true,
          paymentProvider: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              deletedAt: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: customers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCustomerById(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            deletedAt: true,
          },
        },
        jobs: {
          select: {
            id: true,
            type: true,
            status: true,
            createdAt: true,
            completedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const [totalJobs, completedJobs, failedJobs] = await Promise.all([
      this.prisma.job.count({ where: { customerId } }),
      this.prisma.job.count({
        where: { customerId, status: 'COMPLETED' },
      }),
      this.prisma.job.count({ where: { customerId, status: 'FAILED' } }),
    ]);

    return {
      ...customer,
      stats: {
        totalJobs,
        completedJobs,
        failedJobs,
      },
    };
  }

  async updateCustomerPlan(customerId: string, dto: UpdateCustomerPlanDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const planLimits: Record<CustomerPlan, number> = {
      FREE: 1000,
      INDIE: 10000,
      STARTUP: 100000,
    };

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        plan: dto.plan,
        monthlyLimit: planLimits[dto.plan],
        previousPlan: customer.plan !== dto.plan ? customer.plan : undefined,
      },
      select: {
        id: true,
        email: true,
        plan: true,
        monthlyLimit: true,
        previousPlan: true,
        updatedAt: true,
      },
    });

    this.logger.log(
      `Admin updated customer ${customerId} plan from ${customer.plan} to ${dto.plan}`,
    );

    return updated;
  }

  async resetCustomerUsage(customerId: string, dto: ResetCustomerUsageDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        usageCount: dto.usageCount ?? 0,
        usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      },
      select: {
        id: true,
        email: true,
        usageCount: true,
        usageResetAt: true,
        updatedAt: true,
      },
    });

    this.logger.log(
      `Admin reset usage for customer ${customerId} to ${dto.usageCount ?? 0}`,
    );

    return updated;
  }

  /**
   * ================================
   * JOB MANAGEMENT
   * ================================
   */

  async getJobs(query: QueryJobsDto) {
    const { page = 1, limit = 20, status, type, customerId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          customerId: true,
          type: true,
          status: true,
          priority: true,
          attempts: true,
          maxAttempts: true,
          errorMessage: true,
          createdAt: true,
          completedAt: true,
          customer: {
            select: {
              email: true,
              plan: true,
            },
          },
        },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async deleteJob(jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    await this.prisma.job.delete({
      where: { id: jobId },
    });

    this.logger.warn(`Admin hard-deleted job ${jobId}`);

    return {
      message: 'Job deleted successfully',
      jobId,
    };
  }

  /**
   * ================================
   * STATISTICS
   * ================================
   */

  async getStats() {
    const [
      totalUsers,
      activeUsers,
      deletedUsers,
      totalCustomers,
      activeCustomers,
      freeCustomers,
      indieCustomers,
      startupCustomers,
      totalJobs,
      pendingJobs,
      processingJobs,
      completedJobs,
      failedJobs,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: { not: null } } }),
      this.prisma.customer.count(),
      this.prisma.customer.count({ where: { isActive: true } }),
      this.prisma.customer.count({ where: { plan: 'FREE' } }),
      this.prisma.customer.count({ where: { plan: 'INDIE' } }),
      this.prisma.customer.count({ where: { plan: 'STARTUP' } }),
      this.prisma.job.count(),
      this.prisma.job.count({ where: { status: 'PENDING' } }),
      this.prisma.job.count({ where: { status: 'PROCESSING' } }),
      this.prisma.job.count({ where: { status: 'COMPLETED' } }),
      this.prisma.job.count({ where: { status: 'FAILED' } }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        deleted: deletedUsers,
      },
      customers: {
        total: totalCustomers,
        active: activeCustomers,
        byPlan: {
          FREE: freeCustomers,
          INDIE: indieCustomers,
          STARTUP: startupCustomers,
        },
      },
      jobs: {
        total: totalJobs,
        pending: pendingJobs,
        processing: processingJobs,
        completed: completedJobs,
        failed: failedJobs,
      },
    };
  }
}
