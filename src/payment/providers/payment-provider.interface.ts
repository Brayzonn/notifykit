import { CheckoutSessionRequest } from '@/billing/interfaces/billing.interface';

export interface ProviderSubscriptionStatus {
  status: string;
  isActive: boolean;
  currentPeriodEnd: Date | null;
}

export interface PaymentProvider {
  createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<string | null>;

  cancelSubscription(subscriptionId: string): Promise<void>;

  getPaymentMethods?(providerCustomerId: string): Promise<any>;

  getInvoices(providerCustomerId: string): Promise<any[]>;

  getSubscriptionStatus(
    subscriptionId: string,
  ): Promise<ProviderSubscriptionStatus | null>;
}
