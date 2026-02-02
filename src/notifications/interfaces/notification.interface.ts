// ============================================
// REQUEST DTOs INTERFACES
// ============================================

export interface SendEmailRequest {
  to: string;
  subject: string;
  body: string;
  from?: string;
  priority?: number;
  idempotencyKey?: string;
}

export interface SendWebhookRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  payload?: Record<string, any>;
  priority?: number;
  idempotencyKey?: string;
}

// ============================================
// RESPONSE INTERFACES
// ============================================

export interface JobResponse {
  jobId: string;
  status: string;
  type: string;
  createdAt: Date;
}

export interface JobStatusResponse {
  id: string;
  type: string;
  status: string;
  priority: number;
  payload: any;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface JobListItem {
  id: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface JobListResponse {
  data: JobListItem[];
  pagination: PaginationMeta;
}

export interface RetryJobResponse {
  jobId: string;
  status: string;
  message: string;
}

// ============================================
// QUERY OPTIONS INTERFACES
// ============================================

export interface ListJobsOptions {
  page?: number;
  limit?: number;
  type?: 'email' | 'webhook';
  status?: 'pending' | 'processing' | 'completed' | 'failed';
}

// ============================================
// INTERNAL QUEUE PAYLOAD INTERFACES
// ============================================

export interface EmailJobPayload {
  jobId: string;
  customerId: string;
  to: string;
  subject: string;
  body: string;
  from?: string;
}

export interface WebhookJobPayload {
  jobId: string;
  customerId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  payload?: Record<string, any>;
}

// ============================================
// DATABASE PAYLOAD INTERFACES
// ============================================

export interface EmailPayloadData {
  to: string;
  subject: string;
  body: string;
  from?: string;
  [key: string]: any;
}

export interface WebhookPayloadData {
  url: string;
  method: string;
  headers?: Record<string, string>;
  payload?: Record<string, any>;
  [key: string]: any;
}
