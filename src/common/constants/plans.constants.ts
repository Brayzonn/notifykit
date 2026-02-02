import { CustomerPlan } from '@prisma/client';

export const PLAN_LIMITS = {
  [CustomerPlan.FREE]: {
    monthlyLimit: 1000,
    name: 'Free',
    price: 0,
    features: [
      '1,000 notifications/month',
      'Email delivery',
      'Webhook support',
      'Basic monitoring',
      'Community support',
    ],
  },
  [CustomerPlan.INDIE]: {
    monthlyLimit: 10000,
    name: 'Indie',
    price: 9,
    features: [
      '10,000 notifications/month',
      'All Free features',
      'Priority support',
      'Advanced monitoring',
      'Custom email templates',
      'Domain verification',
    ],
  },
  [CustomerPlan.STARTUP]: {
    monthlyLimit: 100000,
    name: 'Startup',
    price: 39,
    features: [
      '100,000 notifications/month',
      'All Indie features',
      'Dedicated support',
      'Advanced analytics',
      'Custom branding',
      'Higher request limits',
    ],
  },
} as const;

export const getPlanLimit = (plan: CustomerPlan): number => {
  return PLAN_LIMITS[plan].monthlyLimit;
};

export const getPlanDetails = (plan: CustomerPlan) => {
  return PLAN_LIMITS[plan];
};
