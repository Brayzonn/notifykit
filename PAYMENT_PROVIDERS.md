# Multi-Provider Payment System

This document describes the multi-provider payment architecture that supports Stripe, Paystack, and future payment providers.

## Architecture Overview

The payment system uses a Strategy Pattern with a factory to abstract payment provider logic:

```
BillingService → PaymentService → PaymentProviderFactory → PaymentProvider (Interface)
                                                                    ↓
                                              ┌─────────────────────┴─────────────────────┐
                                              ↓                                           ↓
                                    StripePaymentProvider                    PaystackPaymentProvider
```

### Key Components

1. **PaymentProvider Interface** - Defines standard methods all providers must implement
2. **Provider Implementations** - Stripe and Paystack implementations
3. **PaymentProviderFactory** - Selects the correct provider based on customer settings
4. **PaymentService** - Uses factory to delegate to appropriate provider
5. **Webhook Handlers** - Provider-specific webhook processing

---

## Supported Payment Providers

### Stripe

- **Region**: Global
- **Webhook Endpoint**: `/api/v1/payment/stripe/webhook`
- **Signature Header**: `stripe-signature`
- **Events Handled**:
  - `checkout.session.completed` → Subscription activated
  - `customer.subscription.updated` → Billing date updated
  - `customer.subscription.deleted` → Subscription cancelled
  - `invoice.payment_succeeded` → Payment recorded
  - `invoice.payment_failed` → Marked as PAST_DUE

### Paystack

- **Region**: Africa (Nigeria, Ghana, South Africa, etc.)
- **Webhook Endpoint**: `/api/v1/payment/paystack/webhook`
- **Signature Header**: `x-paystack-signature`
- **Verification**: HMAC SHA512
- **Events Handled**:
  - `charge.success` → Subscription activated immediately (primary activation path)
  - `subscription.create` → Links subscription code and next billing date
  - `subscription.disable` → Subscription cancelled
  - `invoice.payment_failed` → Marked as PAST_DUE

### Planned Providers

- **Paddle** - SaaS billing platform
- **Flutterwave** - African payments
- **LemonSqueezy** - Merchant of record

---

## PaymentProvider Interface

All payment providers implement this interface:

```typescript
interface PaymentProvider {
  createCheckoutSession(request: CheckoutSessionRequest): Promise<string>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getPaymentMethods(providerCustomerId: string): Promise<any>;
  getInvoices(providerCustomerId: string): Promise<any[]>;
}
```

### Method Descriptions

**createCheckoutSession**

- Creates a checkout/payment session
- Returns: URL to redirect user for payment
- Input: Customer ID, email, plan

**cancelSubscription**

- Cancels/disables a subscription
- Returns: void
- Input: Provider's subscription ID

**getPaymentMethods**

- Retrieves saved payment methods (cards)
- Returns: Array of payment method objects
- Input: Provider's customer ID

**getInvoices**

- Fetches billing history
- Returns: Array of normalized invoice objects
- Input: Provider's customer ID

---

## Environment Variables

### Stripe

```env
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxx
STRIPE_PUBLIC_KEY=pk_test_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
STRIPE_INDIE_PRICE_ID=price_xxxxxxxxxxxxx
STRIPE_STARTUP_PRICE_ID=price_xxxxxxxxxxxxx
```

### Paystack

```env
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxx
PAYSTACK_WEBHOOK_SECRET=xxxxxxxxxxxxx
PAYSTACK_INDIE_PLAN_ID=PLN_xxxxxxxxxxxxx
PAYSTACK_STARTUP_PLAN_ID=PLN_xxxxxxxxxxxxx
PAYSTACK_INDIE_AMOUNT=xxxxxxxxxxxxx
PAYSTACK_STARTUP_AMOUNT=xxxxxxxxxxxxx
```

---

## How It Works

### 1. Customer Upgrades Plan

```
User clicks "Upgrade" → BillingService.createUpgradeCheckout()
  → PaymentService.createCheckoutSession()
  → PaymentProviderFactory.getDefaultProvider()
  → StripePaymentProvider or PaystackPaymentProvider
  → Returns checkout URL → User redirected to payment page
```

```typescript
const checkoutUrl = await this.paymentService.createCheckoutSession({
  customerId: customer.id,
  customerEmail: customer.email,
  plan: targetPlan,
  currentPlan: customer.plan,
});
```

The default provider is configurable in `PaymentProviderFactory.getDefaultProvider()`.

### 2. Payment Succeeds (Webhook)

**Stripe Flow:**

```
Stripe sends POST /api/v1/payment/stripe/webhook
  → StripeWebhookHandler.handle()
  → Verifies signature
  → Parses event
  → BillingService.handleSubscriptionActivated()
  → Updates customer record with subscription data
```

**Paystack Flow:**

```
Paystack sends POST /api/v1/payment/paystack/webhook
  → PaystackWebhookHandler.handle()
  → Returns 200 OK immediately (async processing)
  → Verifies HMAC SHA512 signature
  → charge.success → Provisions access immediately (providerSubscriptionId = null)
  → subscription.create → Links subscription code and next billing date
  → If subscription.create never fires → fetchAndLinkSubscription() fallback after 10s
```

### 3. Customer Cancels Subscription

```
User clicks "Cancel" → BillingService.cancelSubscription()
  → PaymentService.cancelSubscription(subscriptionId)
  → Looks up customer's paymentProvider from database
  → PaymentProviderFactory.getProvider(paymentProvider)
  → Calls appropriate provider's cancelSubscription()
```

```typescript
async cancelSubscription(subscriptionId: string): Promise<void> {
  const customer = await this.prisma.customer.findFirst({
    where: { providerSubscriptionId: subscriptionId },
  });

  const provider = this.providerFactory.getProvider(customer.paymentProvider);
  return provider.cancelSubscription(subscriptionId);
}
```

### 4. Fetching Invoices

```
User views billing history → BillingService.getInvoices()
  → Gets customer's paymentProvider from database
  → PaymentService.getInvoices(customerId, provider)
  → PaymentProviderFactory.getProvider(provider)
  → Calls provider-specific getInvoices()
  → Returns normalized invoice array
```

```typescript
const invoices = await this.paymentService.getInvoices(
  customer.providerCustomerId,
  customer.paymentProvider,
);
```

---

## Webhook Setup

### Stripe Webhook

1. Create webhook in Stripe Dashboard:

```
URL: https://yourdomain.com/api/v1/payment/stripe/webhook
Events:
  - checkout.session.completed
  - customer.subscription.updated
  - customer.subscription.deleted
  - invoice.payment_succeeded
  - invoice.payment_failed
```

2. Copy webhook signing secret:

```
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

3. Test locally with Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/v1/payment/stripe/webhook
```

### Paystack Webhook

1. Configure in Paystack Dashboard:

```
Settings → Webhooks → Add Endpoint
URL: https://yourdomain.com/api/v1/payment/paystack/webhook
```

2. Copy webhook secret:

```
PAYSTACK_WEBHOOK_SECRET=xxxxxxxxxxxxx
```

3. Test with ngrok to expose local server:

```bash
ngrok http 3000
```

---

## Field Mapping

Different providers use different field names. We normalize them:

### Subscription Data

| Standard Field         | Stripe               | Paystack                                                   |
| ---------------------- | -------------------- | ---------------------------------------------------------- |
| providerSubscriptionId | `subscription.id`    | `subscription_code`                                        |
| providerCustomerId     | `customer.id`        | `customer.customer_code` (numeric ID used for API queries) |
| plan                   | `metadata.plan`      | Mapped from `plan.plan_code`                               |
| nextBillingDate        | `current_period_end` | `next_payment_date`                                        |

### Invoice Data

| Standard Field | Stripe              | Paystack                  |
| -------------- | ------------------- | ------------------------- |
| id             | `invoice.id`        | `transaction.reference`   |
| amount         | `amount_paid / 100` | `amount / 100`            |
| currency       | `invoice.currency`  | `transaction.currency`    |
| status         | `invoice.status`    | `transaction.status`      |
| date           | `created * 1000`    | `paid_at` or `created_at` |
| pdfUrl         | `invoice_pdf`       | `null` (not supported)    |

---

## Adding a New Provider

To add support for a new payment provider (e.g., Paddle):

### 1. Create Provider Implementation

```typescript
@Injectable()
export class PaddlePaymentProvider implements PaymentProvider {
  async createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<string> {
    // Implement Paddle checkout
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    // Implement Paddle cancellation
  }

  async getPaymentMethods(providerCustomerId: string): Promise<any> {
    // Implement Paddle payment methods
  }

  async getInvoices(providerCustomerId: string): Promise<any[]> {
    // Implement Paddle invoices
  }
}
```

### 2. Create Webhook Handler

```typescript
@Injectable()
export class PaddleWebhookHandler {
  async handle(event: PaddleEvent) {
    switch (event.alert_name) {
      case 'subscription_created':
        await this.handleSubscriptionCreated(event);
        break;
    }
  }
}
```

### 3. Update Factory

```typescript
getProvider(provider: PaymentProviderEnum): PaymentProvider {
  switch (provider) {
    case PaymentProviderEnum.PADDLE:
      return this.paddleProvider;
  }
}
```

### 4. Register in Module

```typescript
providers: [
  PaddlePaymentProvider,
  PaddleWebhookHandler,
],
```

### 5. Add Webhook Endpoint

```typescript
@Post('paddle/webhook')
async handlePaddleWebhook(@Req() req, @Headers('paddle-signature') signature) {
  return this.paddleWebhookHandler.handle(req.rawBody, signature);
}
```

### 6. Add Environment Variables

```env
PADDLE_VENDOR_ID=xxxxx
PADDLE_API_KEY=xxxxx
PADDLE_WEBHOOK_SECRET=xxxxx
PADDLE_INDIE_PRODUCT_ID=xxxxx
PADDLE_STARTUP_PRODUCT_ID=xxxxx
```

---

## Database Schema

The `Customer` model supports multiple providers:

```prisma
model Customer {
  paymentProvider        PaymentProvider?    @map("payment_provider")
  providerCustomerId     String?             @map("provider_customer_id")
  providerSubscriptionId String?             @map("provider_subscription_id")
  nextBillingDate        DateTime?           @map("next_billing_date")
  subscriptionEndDate    DateTime?           @map("subscription_end_date")
}
```

- `paymentProvider` - Which provider the customer uses
- `providerCustomerId` - Customer ID in the provider's system
- `providerSubscriptionId` - Subscription ID in the provider's system
- `nextBillingDate` - Next billing date from the provider (nullable, set after subscription.create)
- `subscriptionEndDate` - When current billing period ends

---

## Testing

### Unit Tests

```typescript
describe('StripePaymentProvider', () => {
  it('should create checkout session', async () => {
    const url = await provider.createCheckoutSession({
      customerId: 'cus_123',
      customerEmail: 'test@example.com',
      plan: CustomerPlan.INDIE,
    });
    expect(url).toContain('checkout.stripe.com');
  });
});
```

### Webhook Testing

**Stripe:**

```bash
stripe trigger checkout.session.completed
```

**Paystack:**
Use ngrok to expose your local server and trigger test payments from Paystack dashboard.

### E2E Tests

```typescript
it('should handle full upgrade flow with Stripe', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/billing/upgrade')
    .send({ plan: 'INDIE' });

  await request(app.getHttpServer())
    .post('/api/v1/payment/stripe/webhook')
    .send(mockStripeEvent);

  const customer = await prisma.customer.findUnique(...);
  expect(customer.plan).toBe('INDIE');
});
```

---

## Security Considerations

1. **Webhook Signature Verification** - Always verify signatures before processing. Reject invalid signatures immediately.
2. **Environment Variables** - Never commit secrets to Git. Use different keys for test/production. Rotate webhook secrets periodically.
3. **Error Handling** - Don't expose provider errors to users. Log detailed errors internally.
4. **Idempotency** - Handle duplicate webhook deliveries. Use `providerSubscriptionId` to detect duplicates.
5. **Immediate 200 OK** - Return 200 immediately before processing to prevent Paystack from timing out and missing subsequent events.

---

## Monitoring

Key metrics to track:

- Webhook success rate
- Provider API failures
- Payment failures and PAST_DUE counts
- Subscription changes (upgrades, cancellations, downgrades)

Alerts to configure:

- Webhook signature verification failures
- High rate of payment failures
- Provider API downtime
- Unexpected event types

---

## FAQ

**Q: Can a customer switch providers?**
Not currently. Once a subscription is created with a provider, it stays with that provider. To switch, they would need to cancel and create a new subscription.

**Q: Which provider should I use?**

- Stripe: Global, mature, feature-rich
- Paystack: Africa (better local payment methods, lower fees in NGN)

**Q: How do I test webhooks locally?**

- Stripe: Use Stripe CLI (`stripe listen`)
- Paystack: Use ngrok to expose local server

**Q: What if a provider API is down?**
The system will throw an error and the operation will fail. Implement retry logic at the application level for critical operations.

**Q: Why does Paystack activation happen in charge.success and not subscription.create?**
`charge.success` fires reliably on every payment. `subscription.create` is unreliable in test mode and may not fire at all. We provision access immediately on `charge.success` and use `subscription.create` to link the subscription code and billing date. A 10-second fallback API call handles cases where `subscription.create` never arrives.
