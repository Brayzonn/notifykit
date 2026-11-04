import { Injectable, Logger } from '@nestjs/common';
import { AuthProvider, Customer, CustomerPlan, User } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { EmailService } from '@/platform-email/email.service';
import { getPlanLimit } from '@/common/constants/plans.constants';
import { GithubProfile } from '@/auth/interfaces/auth.interface';
import {
  AuthRedisKeys,
  FREE_PLAN_USAGE_PERIOD_MS,
  OTP_TTL_SECONDS,
} from '@/auth/constants/auth.constants';

export type UserWithCustomer = User & { customer?: Customer | null };

export interface PendingSignup {
  email: string;
  password: string;
  name: string;
  company?: string;
}

@Injectable()
export class UserProvisioningService {
  private readonly logger = new Logger(UserProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly emailService: EmailService,
  ) {}

  async upsertGithubUser(
    profile: GithubProfile,
  ): Promise<{ user: UserWithCustomer; isNewUser: boolean }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: { customer: true },
    });

    if (!existing) {
      const user = await this.prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name,
          provider: AuthProvider.GITHUB,
          providerId: profile.githubId,
          emailVerified: true,
          ...(profile.avatar && { avatar: profile.avatar }),
        },
        include: { customer: true },
      });
      return { user, isNewUser: true };
    }

    if (existing.provider === AuthProvider.EMAIL) {
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          provider: AuthProvider.GITHUB,
          providerId: profile.githubId,
          ...(profile.avatar && { avatar: profile.avatar }),
          emailVerified: true,
        },
        include: { customer: true },
      });
      return { user, isNewUser: false };
    }

    return { user: existing, isNewUser: false };
  }

  async upsertEmailUser(signup: PendingSignup): Promise<UserWithCustomer> {
    const existing = await this.prisma.user.findUnique({
      where: { email: signup.email },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          password: signup.password,
          name: signup.name,
          company: signup.company,
          emailVerified: true,
        },
        include: { customer: true },
      });
    }

    return this.prisma.user.create({
      data: {
        email: signup.email,
        password: signup.password,
        name: signup.name,
        company: signup.company,
        provider: AuthProvider.EMAIL,
        emailVerified: true,
      },
      include: { customer: true },
    });
  }

  async ensureCustomer(user: UserWithCustomer): Promise<Customer> {
    if (user.customer) {
      return user.customer;
    }

    return this.prisma.customer.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        email: user.email,
        plan: CustomerPlan.FREE,
        monthlyLimit: getPlanLimit(CustomerPlan.FREE),
        usageCount: 0,
        usageResetAt: new Date(Date.now() + FREE_PLAN_USAGE_PERIOD_MS),
        isActive: true,
      },
    });
  }

  sendWelcomeEmail(user: User): void {
    this.emailService
      .sendWelcomeEmail({ email: user.email, name: user.name })
      .catch((err) =>
        this.logger.error('Failed to send welcome email', err?.message),
      );
  }

  async savePendingSignup(signup: PendingSignup): Promise<void> {
    await this.redis.set(
      AuthRedisKeys.pendingSignup(signup.email),
      JSON.stringify(signup),
      OTP_TTL_SECONDS,
    );
  }

  async getPendingSignup(email: string): Promise<PendingSignup | null> {
    const raw = await this.redis.get(AuthRedisKeys.pendingSignup(email));
    return raw ? JSON.parse(raw) : null;
  }

  async clearPendingSignup(email: string): Promise<void> {
    await this.redis.del(AuthRedisKeys.pendingSignup(email));
  }
}
