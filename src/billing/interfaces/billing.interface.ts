import {
  CustomerPlan,
  PaymentProvider,
  SubscriptionStatus,
} from '@prisma/client';

export type Currency = 'USD' | 'NGN';

export interface CheckoutSessionRequest {
  customerId: string;
  customerEmail: string;
  plan: CustomerPlan;
  currentPlan: CustomerPlan;
  currency: Currency;
  providerSubscriptionId?: string | null;
}

export interface SubscriptionActivatedEvent {
  providerSubscriptionId: string;
  providerCustomerId: string;
  plan: CustomerPlan;
  paymentProvider: PaymentProvider;
  nextBillingDate: Date;
}

export interface CreateCheckoutResponse {
  checkoutUrl: string | null;
  plan: CustomerPlan;
  price: number;
}

export interface CancelSubscriptionResponse {
  message: string;
  effectiveUntil: Date | null;
}

export interface SubscriptionDetailsResponse {
  plan: CustomerPlan;
  status: SubscriptionStatus | null;
  nextBillingDate: Date | null;
  subscriptionEndDate: Date | null;
  paymentProvider: PaymentProvider | null;
  monthlyLimit: number;
}

export interface InvoicesResponse {
  invoices: Invoice[];
  message?: string;
}

export interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: string | null;
  date: Date;
  pdfUrl?: string | null;
}

/**
 * Outcome of reconciling a stale local billing window against the payment
 * provider (the source of truth when a renewal webhook was missed).
 * - RENEWED: active with a future period end; advance the cycle to `periodEnd`.
 * - ACTIVE: provider confirms active but exposes no advanceable period end;
 *   keep the customer unblocked but don't advance dates or downgrade.
 * - LAPSED: provider confirms no longer active; safe to downgrade.
 * - UNKNOWN: provider unreachable or errored; take no authoritative action.
 */
export type ProviderCycleResolution =
  | { action: 'RENEWED'; periodEnd: Date }
  | { action: 'ACTIVE' }
  | { action: 'LAPSED' }
  | { action: 'UNKNOWN' };
