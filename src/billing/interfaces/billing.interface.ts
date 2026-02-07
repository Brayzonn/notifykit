import { CustomerPlan, PaymentProvider } from '@prisma/client';

export interface CheckoutSessionRequest {
  customerId: string;
  customerEmail: string;
  plan: CustomerPlan;
  currentPlan: CustomerPlan;
}

export interface SubscriptionActivatedEvent {
  providerSubscriptionId: string;
  providerCustomerId: string;
  plan: CustomerPlan;
  paymentProvider: PaymentProvider;
  nextBillingDate: Date;
}
