import { CustomerPlan } from '@prisma/client';

export const PLAN_LIMITS = {
  [CustomerPlan.FREE]: {
    monthlyLimit: 100,
    rateLimit: 5,
    logRetentionDays: 14,
    name: 'Free',
    price: 0,
    usesOwnApiKey: false,
    features: [
      '100 notifications/month',
      'Shared email infrastructure',
      'Basic delivery monitoring',
      'Webhook support',
      '14-day log retention',
      'Community support',
    ],
  },

  [CustomerPlan.INDIE]: {
    monthlyLimit: 3000,
    rateLimit: 100,
    logRetentionDays: 90,
    name: 'Indie',
    price: 9,
    usesOwnApiKey: true,
    features: [
      '3,000 notifications/month',
      'Bring your own API key (SendGrid or Resend)',
      'Managed domain verification',
      'Webhook management',
      'Advanced delivery monitoring',
      '90-day log retention',
      'Custom email templates',
      'Priority support',
    ],
  },

  [CustomerPlan.STARTUP]: {
    monthlyLimit: 15000,
    rateLimit: 500,
    logRetentionDays: null,
    name: 'Startup',
    price: 39,
    usesOwnApiKey: true,
    features: [
      '15,000 notifications/month',
      'Bring your own API key (SendGrid or Resend)',
      'Managed domain verification',
      'Webhook management',
      'Advanced monitoring & analytics',
      'Unlimited log retention',
      'Scheduled notifications',
      'Dedicated support',
      'Higher rate limits',
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
