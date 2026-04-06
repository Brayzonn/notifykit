import {
  CustomerPlan,
  PaymentProvider,
  SubscriptionStatus,
} from '@prisma/client';

export interface AuthenticatedCustomer {
  id: string;
  email: string;
  plan: CustomerPlan;
  monthlyLimit: number;
  customMonthlyLimit?: number | null;
  usageCount?: number;
  usageResetAt: Date;
  billingCycleStartAt: Date;
  subscriptionStatus?: SubscriptionStatus;
  paymentProvider?: PaymentProvider;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  subscriptionEndDate?: Date;
}
