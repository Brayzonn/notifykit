import {
  CustomerPlan,
  DeliveryStatus,
  EmailEventType,
  EmailProviderType,
  JobStatus,
  JobType,
} from '@/generated/prisma/client';

export interface SendingDomainSummary {
  domain: string;
  provider: EmailProviderType;
  verified: boolean;
  requestedAt: Date;
  verifiedAt: Date | null;
}

export interface CustomerProfile {
  id: string;
  plan: CustomerPlan;
  monthlyLimit: number;
  usageCount: number;
  usageResetAt: Date;
  billingCycleStartAt: Date;
  isActive: boolean;
  createdAt: Date;
  sendingDomains: SendingDomainSummary[];
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  provider: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  customer: CustomerProfile | null;
}

export interface MessageResponse {
  message: string;
}

export interface EmailChangeRequestResponse {
  message: string;
  expiresIn: number;
}

export interface EmailVerificationResponse {
  message: string;
  bothConfirmed: boolean;
}

export interface EmailChangeSuccessResponse {
  message: string;
  newEmail: string;
}

export interface DashboardSummary {
  usage: {
    plan: string;
    monthlyLimit: number;
    used: number;
    remaining: number;
    resetAt: Date;
  };
  jobs: {
    total: number;
    successful: number;
    failed: number;
    pending: number;
    successRate: string;
    emailJobs: number;
    webhookJobs: number;
  };
  activityByDay: {
    date: string;
    total: number;
    pending: number;
    successful: number;
    failed: number;
  }[];
}

export interface UsageStats {
  plan: 'FREE' | 'INDIE' | 'STARTUP';
  monthlyLimit: number;
  usageCount: number;
  emailsSent: number;
  remaining: number;
  usagePercentage: string;
  usageResetAt: Date;
  billingCycleStartAt: Date;
}

export interface ApiKeyFirstTimeResponse {
  apiKey: string;
  firstTime: true;
  createdAt: Date;
}

export interface ApiKeyMaskedResponse {
  apiKey: string;
  masked: true;
  createdAt: Date;
}

export type ApiKeyResponse = ApiKeyFirstTimeResponse | ApiKeyMaskedResponse;

export interface RegenerateApiKeyResponse {
  apiKey: string;
  message: string;
}

export interface JobDeliveryLog {
  id: string;
  status: DeliveryStatus;
  errorMessage: string | null;
  createdAt: Date;
  jobId: string;
  attempt: number;
  response: any;
  usedProvider: EmailProviderType | null;
}

export interface Job {
  id: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  customerId: string;
  type?: JobType;
  payload?: any;
  metadata?: any;
  scheduledFor?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  retryCount?: number;
  deliveryLogs?: JobDeliveryLog[];
}

export interface JobsPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface JobsHistoryResponse {
  data: Job[];
  pagination: JobsPagination;
}

export interface JobEmailEvent {
  id: string;
  event: EmailEventType;
  email: string;
  occurredAt: Date;
  metadata: any;
}

export interface JobDetailsResponse extends Job {
  deliveryLogs: JobDeliveryLog[];
  emailEvents: JobEmailEvent[];
}

export interface EmailChangeCachePayload {
  oldEmail: string;
  newEmail: string;
  newEmailToken: string;
  oldEmailToken: string;
  newEmailConfirmed: boolean;
  oldEmailConfirmed: boolean;
}

export interface DeleteAccountDto {
  confirmEmail: string;
}
