# Test Suite Summary

**328 tests · 13 suites · all passing**

---

## Overview

| Suite | File | Tests |
|---|---|---|
| EncryptionService | `src/common/encryption/encryption.service.spec.ts` | 12 |
| SendGridService | `src/sendgrid/sendgrid.service.spec.ts` | 12 |
| AuthService | `src/auth/auth.service.spec.ts` | 33 |
| JwtAuthGuard | `src/auth/guards/jwt-auth.guard.spec.ts` | 16 |
| ApiKeyGuard | `src/auth/guards/api-key.guard.spec.ts` | 18 |
| ApiQuotaGuard | `src/auth/guards/api-quota.guard.spec.ts` | 22 |
| BillingService | `src/billing/billing.service.spec.ts` | 31 |
| NotificationsService | `src/notifications/notifications.service.spec.ts` | 28 |
| UserService | `src/user/user.service.spec.ts` | 62 |
| EmailWorkerProcessor | `src/queues/processors/email-worker.processor.spec.ts` | 22 |
| WebhookWorkerProcessor | `src/queues/processors/webhook-worker.processor.spec.ts` | 23 |
| StripeWebhookHandler | `src/payment/webhooks/stripe-webhook.handler.spec.ts` | 22 |
| PaystackWebhookHandler | `src/payment/webhooks/paystack-webhook.handler.spec.ts` | 27 |
| **Total** | | **328** |

---

## Suites

### EncryptionService — 12 tests
`src/common/encryption/encryption.service.spec.ts`

**Initialisation**
- Initialises successfully with a valid 64-char hex key
- Throws when `ENCRYPTION_KEY` is missing
- Throws when key is too short
- Throws when key is too long

**encrypt()**
- Returns a string in `iv:ciphertext` format
- Produces different ciphertexts for the same plaintext (random IV)
- Produces hex-encoded output

**decrypt()**
- Decrypts back to original plaintext
- Handles strings with special characters
- Handles long strings
- Correctly round-trips a typical SendGrid API key
- Is deterministically reversible across multiple encrypt/decrypt cycles

---

### SendGridService — 12 tests
`src/sendgrid/sendgrid.service.spec.ts`

**API key selection**
- Uses the shared key for FREE plan when no customer key is provided
- Uses a customer-provided key when one is passed
- Throws for INDIE plan when no customer key is provided
- Throws for STARTUP plan when no customer key is provided
- Throws when no key is available at all
- Prefers the customer key over the shared key even for FREE plan

**sendEmail()**
- POSTs to the SendGrid `mail/send` endpoint
- Builds the correct SendGrid payload
- Falls back to the default from address when none is provided
- Sends with `Content-Type: application/json`
- Returns `{ statusCode }` on success
- Throws when axios rejects

---

### AuthService — 33 tests
`src/auth/auth.service.spec.ts`

**signin()**
- Successfully authenticates user with valid credentials
- Verifies password using `argon2.verify`
- Generates access and refresh tokens
- Enforces 5-session limit by deleting oldest tokens
- Throws `UnauthorizedException` for invalid email
- Throws `UnauthorizedException` for invalid password
- Throws `UnauthorizedException` if email not verified
- Throws `UnauthorizedException` if account deleted

**requestPasswordReset()**
- Generates a 6-digit OTP and stores in Redis with 10-minute TTL
- Sends reset email via `EmailService`
- Returns generic message for non-existent user (prevents information disclosure)
- Cleans up Redis if email send fails
- Throws `BadRequestException` for social login accounts

**confirmPasswordReset()**
- Validates OTP from Redis
- Hashes new password with argon2
- Updates password in database
- Deletes all refresh tokens (invalidates all sessions)
- Deletes OTP from Redis after success
- Throws `UnauthorizedException` for invalid OTP
- Throws `UnauthorizedException` for expired OTP
- Throws `UnauthorizedException` if user not found

**refreshToken()**
- Verifies JWT with refresh secret
- Validates token exists in database
- Returns only new access token if > 24 hours remaining
- Rotates both tokens if < 24 hours remaining
- Deletes old refresh token on rotation
- Throws `UnauthorizedException` for invalid JWT
- Throws `UnauthorizedException` if token not in DB
- Throws `UnauthorizedException` if token expired
- Throws `UnauthorizedException` if account deleted

**logout()**
- Deletes refresh token from database
- Is idempotent (no error if token does not exist)
- Logs successful logout

---

### JwtAuthGuard — 16 tests
`src/auth/guards/jwt-auth.guard.spec.ts`

**@Public() decorator**
- Checks `isPublic` metadata using `Reflector`
- Bypasses authentication if `isPublic = true`
- Does not call `super.canActivate()` for public routes
- Delegates to `super.canActivate()` for protected routes
- Logs authentication attempts
- Checks both handler and class metadata
- Prioritises handler metadata over class metadata

**Error handling**
- Throws `UnauthorizedException` for `TokenExpiredError`
- Throws `UnauthorizedException` for `JsonWebTokenError`
- Throws `UnauthorizedException` if no authorisation header
- Throws generic `UnauthorizedException` for unknown errors
- Re-throws error if `err` parameter is provided
- Logs authentication failures

**Success**
- Returns user object on successful authentication
- Does not throw when user is authenticated
- Preserves user object properties

---

### ApiKeyGuard — 18 tests
`src/auth/guards/api-key.guard.spec.ts`

**Key extraction**
- Extracts API key from `x-api-key` header
- Extracts API key from `Authorization: Bearer` header
- Prioritises `x-api-key` over `Authorization` header
- Throws `UnauthorizedException` if API key is missing

**Format validation**
- Validates format: `nh_[64 hex chars]`
- Throws `UnauthorizedException` for invalid format (wrong prefix)
- Throws `UnauthorizedException` for invalid format (wrong length)
- Throws `UnauthorizedException` for invalid format (non-hex chars)
- Logs invalid format attempts

**Hash lookup**
- Hashes API key with SHA-256
- Queries Prisma by `apiKeyHash`
- Throws `UnauthorizedException` if API key not found

**Customer validation**
- Checks `customer.isActive` is true
- Checks `customer.user.deletedAt` is null
- Throws `ForbiddenException` if account deleted
- Throws `ForbiddenException` if account inactive

**Request enrichment**
- Attaches customer object to request
- Includes all required fields in customer object
- Returns `true` on success

---

### ApiQuotaGuard — 22 tests
`src/auth/guards/api-quota.guard.spec.ts`

**Customer check**
- Throws `HttpException` if customer not on request
- Uses status 500 (`INTERNAL_SERVER_ERROR`)

**Billing cycle reset**
- Resets usage for FREE plan when `usageResetAt` < now
- Resets usage for active subscriptions
- Updates `usageResetAt` to 30 days from now
- Logs FREE plan reset

**Subscription expiry & grace period**
- Handles 7-day grace period after subscription expiry
- Downgrades to FREE after grace period expires
- Syncs customer plan to FREE in-memory after downgrade
- Logs grace period warnings with days left
- Logs downgrade after grace period

**Usage limit enforcement**
- Checks `usageCount >= monthlyLimit`
- Throws `ForbiddenException` if limit exceeded
- Includes current usage and reset date in error message
- Logs warning when limit exceeded

**Usage increment**
- Calls `authService.incrementUsage` on success
- Updates `customer.usageCount` in-memory
- Logs usage (debug level)
- Returns `true` on success

**Edge cases**
- Handles `usageCount = 0`
- Handles `usageCount = undefined` (falls back to 0)
- Handles exactly at limit (`usageCount === monthlyLimit`)

---

### BillingService — 31 tests
`src/billing/billing.service.spec.ts`

**createUpgradeCheckout()**
- Throws `NotFoundException` when customer is not found
- Throws `BadRequestException` when already on the target plan
- Throws `BadRequestException` when downgrading an ACTIVE subscription
- Uses the waiting message when downgrading a CANCELLED (not yet expired) subscription
- Allows downgrade when subscription status is EXPIRED
- Allows downgrade when subscription status is PAST_DUE
- Auto-downgrades a CANCELLED+expired subscription then creates checkout
- Returns checkout URL, plan, and price

**cancelSubscription()**
- Throws `NotFoundException` when customer is not found
- Throws `BadRequestException` for a FREE plan customer
- Throws `BadRequestException` when no `providerSubscriptionId`
- Throws `BadRequestException` when no `paymentProvider`
- Cancels the subscription and returns the effective-until date

**getSubscriptionDetails()**
- Throws `NotFoundException` when customer is not found
- Returns subscription details

**getInvoices()**
- Throws `NotFoundException` when customer is not found
- Returns empty invoices when no provider is linked
- Delegates to `paymentService` and returns invoices

**handleSubscriptionActivated()**
- Throws `NotFoundException` when customer is not found
- Updates the customer with plan, limits, and ACTIVE status
- Uses `nextBillingDate` as `usageResetAt` when provided
- Falls back to a computed date when `nextBillingDate` is null
- Invalidates the Redis user cache

**handleSubscriptionCancelled()**
- Warns and returns without throwing when customer is not found
- Marks the subscription as CANCELLED

**handleSubscriptionExpired()**
- Warns and returns without throwing when customer is not found
- Resets the customer to the FREE plan with EXPIRED status

**downgradeToFreePlan()**
- Throws when customer is not found
- Updates to FREE plan, resets usage, and sets EXPIRED status

**resetMonthlyUsage()**
- Resets `usageCount` to 0 and sets `usageResetAt` 30 days from now

**incrementUsage()**
- Increments `usageCount` by 1

---

### NotificationsService — 28 tests
`src/notifications/notifications.service.spec.ts`

**sendEmail()**
- Throws `ConflictException` when an idempotency duplicate exists
- Includes the `existingJobId` in the `ConflictException` response
- Does not check idempotency when no key is provided
- Throws when customer is not found
- Throws `BadRequestException` for INDIE plan without a SendGrid API key
- Throws `BadRequestException` for STARTUP plan without a SendGrid API key
- Allows FREE plan to proceed without a SendGrid API key
- Creates the job in Prisma with the correct fields
- Queues the email job via `QueueService`
- Uses the custom priority when provided
- Returns `jobId`, `status`, `type`, and `createdAt`

**sendWebhook()**
- Throws `ConflictException` when an idempotency duplicate exists
- Creates the webhook job in Prisma with the correct fields
- Defaults method to `POST` when not provided
- Queues the webhook job via `QueueService`
- Returns `jobId`, `status`, `type`, and `createdAt`

**getJobStatus()**
- Returns `null` when the job is not found
- Returns the job with lowercased `status` and `type`

**listJobs()**
- Defaults to page 1 and limit 20
- Caps limit at 100
- Applies a type filter when provided
- Applies a status filter when provided
- Returns data with correct pagination meta

**retryJob()**
- Returns `null` when the job is not found or not in FAILED status
- Throws `BadRequestException` when retrying an EMAIL job on a paid plan without a SendGrid key
- Updates the job status to PENDING and re-queues an EMAIL job
- Updates the job status to PENDING and re-queues a WEBHOOK job
- Returns the retry response with pending status

---

### UserService — 62 tests
`src/user/user.service.spec.ts`

**getUserProfile()**
- Throws `NotFoundException` when user is not found
- Returns the user without the password field

**changePassword()**
- Throws `NotFoundException` when user is not found
- Throws `BadRequestException` for OAuth users
- Throws `BadRequestException` when user has no password set
- Throws `UnauthorizedException` for an incorrect current password
- Hashes the new password and updates the user
- Invalidates the Redis cache and returns success

**requestEmailChange()**
- Throws `NotFoundException` when user is not found
- Throws `BadRequestException` when password is missing for EMAIL provider
- Throws `UnauthorizedException` for a wrong password
- Throws `BadRequestException` when the new email is already in use
- Stores change data and both tokens in Redis
- Sends verification to new email and confirmation to old email
- Skips password check for OAuth provider users
- Returns message and `expiresIn: 1800`

**verifyNewEmail()**
- Throws `UnauthorizedException` for an invalid or expired token
- Throws `UnauthorizedException` when the email change request is not found
- Throws `UnauthorizedException` for a mismatched token
- Marks `newEmailConfirmed` and updates Redis
- Completes the email change when both sides have confirmed

**confirmOldEmail()**
- Throws `UnauthorizedException` for an invalid token
- Marks `oldEmailConfirmed` in Redis
- Returns `bothConfirmed: false` when new email is not yet verified

**cancelEmailChange()**
- Throws `UnauthorizedException` for an invalid token
- Deletes all three Redis keys
- Sends a cancellation email to the old address

**deleteAccount()**
- Throws `NotFoundException` when user is not found
- Throws `UnauthorizedException` when the confirm email does not match
- Soft-deletes the user by setting `deletedAt`
- Deactivates the customer and deletes all refresh tokens
- Invalidates the Redis cache and returns a success message

**getApiKey()**
- Throws `NotFoundException` when customer is not found
- Throws `NotFoundException` when no API key has been generated yet
- Returns the plaintext key on first reveal and nulls it in DB
- Returns a masked key on subsequent requests

**regenerateApiKey()**
- Throws `BadRequestException` when confirm email does not match
- Throws `NotFoundException` when user or customer is not found
- Generates a new `nh_` prefixed key and persists it

**saveCustomerSendgridKey()**
- Throws `NotFoundException` when customer is not found
- Throws `BadRequestException` for FREE plan customers
- Throws `BadRequestException` for an invalid SendGrid API key
- Encrypts the key before saving
- Returns a success message

**getCustomerSendgridKey()**
- Throws `NotFoundException` when customer is not found
- Returns `{ hasKey: true, addedAt, lastFour }` when a key exists
- Returns `{ hasKey: false, addedAt: null, lastFour: null }` when no key exists

**removeCustomerSendgridKey()**
- Throws `NotFoundException` when customer is not found
- Nulls out the key fields and returns a success message

**requestDomainVerification()**
- Throws `NotFoundException` when customer is not found
- Throws `BadRequestException` for FREE plan
- Throws `BadRequestException` for an invalid domain format
- Throws `BadRequestException` when the domain is already verified by another customer
- Deletes the old SendGrid domain before authenticating a new one
- Calls `authenticateDomain` and saves the result to DB
- Returns domain, status pending, and DNS records

**getDomainStatus()**
- Throws `NotFoundException` when customer is not found
- Returns `{ status: false }` when no domain is configured
- Returns full domain info when a domain is configured

**removeDomain()**
- Throws `NotFoundException` when customer is not found
- Calls `deleteDomain` when `sendgridDomainId` is set
- Clears all domain fields and returns success

---

### EmailWorkerProcessor — 22 tests
`src/queues/processors/email-worker.processor.spec.ts`

**processEmail() — happy path**
- Successfully processes email job on first attempt
- Uses verified custom domain for sending
- Uses provided from address if specified
- Tracks attempts correctly on retry
- Decrypts and passes the customer key for INDIE plan
- Decrypts and passes the customer key for STARTUP plan
- Passes undefined key for FREE plan with no `sendgridApiKey`
- Does not call decrypt when `sendgridApiKey` is null

**processEmail() — failures & retries**
- Logs failure when SendGrid returns error
- Extracts error message from SendGrid response
- Retries failed job with exponential backoff
- Succeeds on second attempt after first failure
- Moves to dead letter queue after max retries
- Is moved to DLQ by BullMQ after all retries exhausted

**Domain validation**
- Rejects unverified custom domain
- Rejects sending from main domain without `em` subdomain

**BullMQ lifecycle events**
- Logs when job becomes active
- Logs when job completes
- Handles job failure event
- Handles missing customer gracefully
- Handles missing job in database

---

### WebhookWorkerProcessor — 23 tests
`src/queues/processors/webhook-worker.processor.spec.ts`

**processWebhook() — happy path**
- Successfully processes webhook job on first attempt
- Supports different HTTP methods
- Accepts 2xx status codes as success
- Includes custom headers in request
- Handles webhook without custom headers
- Handles webhook with GET method (no body)
- Respects 30-second timeout

**processWebhook() — failures**
- Logs failure when webhook returns 5xx error
- Logs failure when webhook times out
- Logs failure on network error

**Retry logic**
- Does NOT retry on 4xx client errors
- Retries on 5xx server errors
- Retries on network errors
- Does NOT retry on 404 Not Found
- Does NOT retry on 401 Unauthorised
- Succeeds on retry after transient 5xx error
- Moves to dead letter queue after max retries for 5xx errors
- Immediately moves to DLQ for non-retryable 4xx errors

**BullMQ lifecycle events**
- Handles job failure event after all retries
- Logs when job becomes active
- Logs when job completes
- Handles job failure event
- Handles missing job in database

---

### StripeWebhookHandler — 22 tests
`src/payment/webhooks/stripe-webhook.handler.spec.ts`

**Signature verification**
- Successfully verifies valid signature
- Extracts metadata and activates subscription
- Handles missing metadata gracefully
- Handles missing subscription gracefully

**checkout.session.completed**
- Extracts `subscription.current_period_end` correctly
- Updates `nextBillingDate` from subscription item

**customer.subscription.updated / deleted**
- Handles customer not found gracefully
- Calls `billingService.handleSubscriptionCancelled`
- Logs deletion

**invoice.payment_succeeded**
- Updates `lastPaymentDate`
- Handles missing customer gracefully

**invoice.payment_failed**
- Marks subscription as `PAST_DUE`
- Sends payment failed email
- Handles email send errors gracefully
- Includes retry date if available

**Unknown events & error handling**
- Logs unhandled event type
- Returns `{ received: true }` for unknown events
- Logs error when subscription retrieval fails
- Throws and logs error when event handler throws

---

### PaystackWebhookHandler — 27 tests
`src/payment/webhooks/paystack-webhook.handler.spec.ts`

**Signature verification**
- Throws when `PAYSTACK_SECRET_KEY` is not configured
- Throws `UnauthorizedException` for an invalid signature
- Processes the event when the signature is valid

**charge.success**
- Calls `handleSubscriptionActivated` with `null` `providerSubscriptionId`
- Skips when the customer is already ACTIVE on the same plan
- Logs and skips when metadata is missing
- Logs and skips when customer code is missing
- Logs and skips when plan code is missing

**subscription.create**
- Updates the customer with subscription code and next billing date
- Handles the STARTUP plan code correctly
- Skips when the subscription is already linked
- Warns and skips when required data is missing
- Warns and skips on an unknown plan code
- Warns and skips when the customer is not found
- Warns and skips when `next_payment_date` is absent

**subscription.disable**
- Cancels the subscription
- Warns and skips when subscription code is missing

**invoice.payment_failed**
- Marks the subscription as `PAST_DUE`
- Sends a payment failed email
- Divides amount by 100 (kobo → naira)
- Defaults amount to 0 when absent
- Warns and skips when subscription code is missing
- Warns and skips when the customer is not found
- Handles email send errors gracefully and still returns `{ received: true }`

**Unknown events & error handling**
- Logs unhandled event type
- Returns `{ received: true }` for unknown events
- Rethrows errors from event handlers and logs them

---

## Running Tests

```bash
# All tests
npx jest --no-coverage

# Single suite
npx jest src/user/user.service.spec.ts --no-coverage

# With coverage report
npx jest

# Watch mode
npx jest --watch
```

## Test Infrastructure

**`test/helpers/test-utils.ts`** — shared mock factories
- `createMockPrismaService()` — typed Prisma mock (user, customer, refreshToken, job, deliveryLog)
- `createMockRedisService()` — typed Redis mock (get, set, del, exists, getClient)
- `createMockJwtService()` — typed JWT mock
- `createMockConfigService()` — typed config mock with default values
- `createMockEmailService()` — typed email mock

**`test/helpers/mock-factories.ts`** — domain fixture factories
- `createMockUser()`, `createMockCustomer()`, `createMockRefreshToken()`
- `createMockStripeSubscription()`, `createMockStripeCheckoutSession()`, `createMockStripeInvoice()`, `createMockStripeEvent()`
- `createMockAuthenticatedCustomer()`
