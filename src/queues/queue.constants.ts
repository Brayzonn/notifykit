export const QUEUE_NAMES = {
  EMAIL: 'notifications-email',
  WEBHOOK: 'notifications-webhook',
  FAILED: 'notifications-failed',
} as const;

export const JOB_NAMES = {
  SEND_EMAIL: 'send-email',
  SEND_WEBHOOK: 'send-webhook',
  FAILED_JOB: 'failed-job',
} as const;

export type QueueType = 'email' | 'webhook' | 'failed';

export const QUEUE_PRIORITIES = {
  CRITICAL: 10,
  NORMAL: 5,
  LOW: 1,
} as const;

export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  DELAYS: {
    ATTEMPT_1: 0,
    ATTEMPT_2: 120000,
    ATTEMPT_3: 240000,
  },
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
export type QueuePriority =
  (typeof QUEUE_PRIORITIES)[keyof typeof QUEUE_PRIORITIES];
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
