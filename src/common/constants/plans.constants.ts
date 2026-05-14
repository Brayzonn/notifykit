import { CustomerPlan } from '@prisma/client';

export const PLAN_LIMITS = {
  [CustomerPlan.FREE]: {
    monthlyLimit: 100,
    rateLimit: 5,
    logRetentionDays: 14,
    name: CustomerPlan.FREE,
    price: 0,
    usesOwnApiKey: false,
    features: [
      '100 notifications/month (emails + webhooks)',
      '5 requests/minute rate limit',
      'Shared email infrastructure',
      'Basic delivery monitoring',
      'Webhook support',
      '14-day log retention',
      'Community support',
    ],
  },

  [CustomerPlan.INDIE]: {
    monthlyLimit: 4000,
    rateLimit: 50,
    logRetentionDays: 90,
    name: CustomerPlan.INDIE,
    price: 5,
    priceNgn: 5000,
    usesOwnApiKey: true,
    features: [
      '4,000 webhook notifications/month',
      'Unlimited email notifications (via your own provider)',
      '50 requests/minute rate limit',
      'Bring your own email API key (SendGrid, Resend, Postmark)',
      'Managed domain verification',
      'Delivery logs with per-attempt history',
      '90-day log retention',
      'Priority support',
    ],
  },

  [CustomerPlan.STARTUP]: {
    monthlyLimit: 15000,
    rateLimit: 200,
    logRetentionDays: null,
    name: CustomerPlan.STARTUP,
    price: 15,
    priceNgn: 15000,
    usesOwnApiKey: true,
    features: [
      '15,000 webhook notifications/month',
      'Unlimited email notifications (via your own provider)',
      '200 requests/minute rate limit',
      'Bring your own email API key (SendGrid, Resend, Postmark)',
      'Managed domain verification',
      'Delivery logs with per-attempt history',
      'Unlimited log retention',
      'Scheduled notifications',
      'Dedicated support',
    ],
  },
} as const;

/**
 * Returns the monthly notification limit for a plan.
 */
export const getPlanLimit = (plan: CustomerPlan): number => {
  return PLAN_LIMITS[plan].monthlyLimit;
};

/**
 * Returns log retention period (null = unlimited).
 */
export const getLogRetentionPeriod = (plan: CustomerPlan): number | null => {
  return PLAN_LIMITS[plan].logRetentionDays;
};

/**
 * Returns rate limit requests per minute
 */
export const getPlanRateLimit = (plan: CustomerPlan): number => {
  return PLAN_LIMITS[plan].rateLimit;
};

/**
 * Whether the plan requires user-provided API key.
 */
export const planUsesOwnApiKey = (plan: CustomerPlan): boolean => {
  return PLAN_LIMITS[plan].usesOwnApiKey;
};

/**
 * Returns full plan details.
 */
export const getPlanDetails = (plan: CustomerPlan) => {
  return PLAN_LIMITS[plan];
};
