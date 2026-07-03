# Test Suite Summary

**Unit: 483 tests · 27 suites · all passing** · **E2E: 39 scenarios · 3 specs**

> This file lists suites and counts only (regenerate with `npx jest --no-coverage`).
> Individual test names live in the spec files themselves — see each `describe`/`it` block.

---

## Unit suites

| Suite | File | Tests |
|---|---|---|
| AdminService | `src/admin/admin.service.spec.ts` | 11 |
| AuthService | `src/auth/auth.service.spec.ts` | 33 |
| ApiKeyGuard | `src/auth/guards/api-key.guard.spec.ts` | 21 |
| ApiQuotaGuard | `src/auth/guards/api-quota.guard.spec.ts` | 27 |
| JwtAuthGuard | `src/auth/guards/jwt-auth.guard.spec.ts` | 16 |
| BillingService | `src/billing/billing.service.spec.ts` | 55 |
| EncryptionService | `src/common/encryption/encryption.service.spec.ts` | 12 |
| SlackService | `src/common/slack/slack.service.spec.ts` | 4 |
| CORS config | `src/config/cors.config.spec.ts` | 4 |
| EmailProviderFactory | `src/email-providers/email-provider.factory.spec.ts` | 8 |
| PlatformEmailSenderService | `src/email-providers/platform-email-sender.service.spec.ts` | 6 |
| PostmarkSignatureGuard | `src/email-providers/postmark/guards/postmark-signature.guard.spec.ts` | 8 |
| PostmarkDomainService | `src/email-providers/postmark/postmark-domain.service.spec.ts` | 9 |
| PostmarkEventsService | `src/email-providers/postmark/postmark-events.service.spec.ts` | 7 |
| PostmarkService | `src/email-providers/postmark/postmark.service.spec.ts` | 10 |
| ResendSignatureGuard | `src/email-providers/resend/guards/resend-signature.guard.spec.ts` | 9 |
| ResendEventsService | `src/email-providers/resend/resend-events.service.spec.ts` | 16 |
| SendGridCustomerSignatureGuard | `src/email-providers/sendgrid/guards/sendgrid-customer-signature.guard.spec.ts` | 8 |
| SendGridSignatureGuard | `src/email-providers/sendgrid/guards/sendgrid-signature.guard.spec.ts` | 8 |
| SendGridEventsService | `src/email-providers/sendgrid/sendgrid-events.service.spec.ts` | 16 |
| SendGridService | `src/email-providers/sendgrid/sendgrid.service.spec.ts` | 9 |
| NotificationsService | `src/notifications/notifications.service.spec.ts` | 37 |
| PaystackWebhookHandler | `src/payment/webhooks/paystack-webhook.handler.spec.ts` | 28 |
| EmailWorkerProcessor | `src/queues/processors/email-worker.processor.spec.ts` | 28 |
| PlatformEmailProcessor | `src/queues/processors/platform-email.processor.spec.ts` | 9 |
| WebhookWorkerProcessor | `src/queues/processors/webhook-worker.processor.spec.ts` | 21 |
| UserService | `src/user/user.service.spec.ts` | 63 |
| **Total** | | **483** |

## E2E specs

Run through the real production pipeline via `configureApp()` (`src/config/configure-app.ts`) — global filter, interceptor, validation pipe, `api` prefix, and `v1` URI versioning included. Requires Postgres + Redis running.

| Spec | File | Scenarios |
|---|---|---|
| App pipeline (envelope, prefix/versioning, validation shape) | `test/app.e2e-spec.ts` | 3 |
| Auth (signup → verify → signin, refresh rotation, session limits, OTP resend) | `test/auth.e2e-spec.ts` | 18 |
| Password reset | `test/password-reset.e2e-spec.ts` | 18 |
| **Total** | | **39** |

---

## Running Tests

```bash
# All unit tests
npm run test

# Single suite
npx jest src/user/user.service.spec.ts --no-coverage

# With coverage report
npm run test:cov

# E2E tests (needs Postgres + Redis up)
npm run test:e2e

# Watch mode
npm run test:watch
```

## Test Infrastructure

**`test/helpers/test-utils.ts`** — shared mock factories
- `createMockPrismaService()` — typed Prisma mock (user, customer, refreshToken, job, deliveryLog)
- `createMockRedisService()` — typed Redis mock (get, set, del, exists, getClient)
- `createMockJwtService()` — typed JWT mock
- `createMockConfigService()` — typed config mock with default values (`getOrThrow` throws on missing keys)
- `createMockEmailService()` — typed email mock
- `closeBullQueues()`, `extractOtpFromRedis()`, `waitForAsync()` — e2e utilities

**`test/helpers/mock-factories.ts`** — domain fixture factories
- `createMockUser()`, `createMockCustomer()`, `createMockRefreshToken()`
- `makeSendingDomain()`, `createMockAuthenticatedCustomer()`
