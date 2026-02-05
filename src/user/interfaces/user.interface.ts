/* =====================================================
 * USER PROFILE
 * ===================================================== */

import {
  CustomerPlan,
  DeliveryStatus,
  JobStatus,
  JobType,
} from '@prisma/client';

export interface CustomerProfile {
  id: string;
  plan: CustomerPlan;
  monthlyLimit: number;
  usageCount: number;
  usageResetAt: Date;
  billingCycleStartAt: Date;
  isActive: boolean;
  createdAt: Date;
  sendingDomain: string | null;
  domainVerified: boolean;
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

/* =====================================================
 * AUTH / ACCOUNT RESPONSES
 * ===================================================== */

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

/* =====================================================
 * DASHBOARD
 * ===================================================== */

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

/* =====================================================
 * USAGE & BILLING
 * ===================================================== */

export interface UsageStats {
  plan: 'FREE' | 'INDIE' | 'STARTUP';
  monthlyLimit: number;
  usageCount: number;
  remaining: number;
  usagePercentage: string;
  usageResetAt: Date;
  billingCycleStartAt: Date;
}

/* =====================================================
 * API KEY
 * ===================================================== */

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

/* =====================================================
 * JOBS / HISTORY
 * ===================================================== */

export interface JobDeliveryLog {
  id: string;
  status: DeliveryStatus;
  errorMessage: string | null;
  createdAt: Date;
  jobId: string;
  attempt: number;
  response: any;
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

/* =====================================================
 * JOB DETAILS (SINGLE JOB)
 * ===================================================== */

export interface JobDetailsResponse extends Job {
  deliveryLogs: JobDeliveryLog[];
}

/* =====================================================
 * EMAIL CHANGE (REDIS PAYLOAD)
 * ===================================================== */

export interface EmailChangeCachePayload {
  oldEmail: string;
  newEmail: string;
  newEmailToken: string;
  oldEmailToken: string;
  newEmailConfirmed: boolean;
  oldEmailConfirmed: boolean;
}

/* =====================================================
 * DELETE ACCOUNT
 * ===================================================== */

export interface DeleteAccountDto {
  confirmEmail: string;
}
