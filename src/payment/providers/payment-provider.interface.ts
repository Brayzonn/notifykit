import { CheckoutSessionRequest } from '@/billing/interfaces/billing.interface';

export interface PaymentProvider {
  /**
   * Create a checkout session for upgrading to a plan
   * @returns The checkout URL where the user should be redirected
   */
  createCheckoutSession(request: CheckoutSessionRequest): Promise<string>;

  /**
   * Cancel a subscription
   */
  cancelSubscription(subscriptionId: string): Promise<void>;

  /**
   * Get payment methods for a customer
   */
  getPaymentMethods(providerCustomerId: string): Promise<any>;

  /**
   * Get invoices for a customer
   */
  getInvoices(providerCustomerId: string): Promise<any[]>;
}
