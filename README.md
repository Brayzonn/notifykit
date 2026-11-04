# NotifyKit API

The backend API for [NotifyKit](https://notifykit.dev), notification infrastructure for modern products.

---

## What NotifyKit Is

NotifyKit is a backend notification infrastructure API that lets a product
send emails and webhooks through a single integration. It handles queued
delivery with automatic retries, logging, multi provider failover for email, and HMAC signed webhooks

## Problems It Solves

Provider lock in and single points of failure. Instead of depending on
one email provider, customers can configure multiple providers with a
priority order. If the first one fails, NotifyKit automatically falls
back to the next.

Building retry and queue logic from scratch. Every product that sends
emails or webhooks eventually needs a job queue, exponential backoff,
and delivery tracking. NotifyKit provides this out of the box through
BullMQ workers, so customers don't have to build and maintain it
themselves.

Verifying webhook authenticity. Customers can generate an HMAC signing
secret so every outgoing webhook includes a signature the receiving
server can verify, protecting against spoofed or tampered requests.

Operational visibility. Every job's status, attempt count, and which
provider ultimately delivered it is queryable.

## Tech Stack

- **Framework**: NestJS
- **Database**: PostgreSQL + Prisma ORM
- **Cache/Queue**: Redis
- **Auth**: JWT (access + refresh tokens), GitHub OAuth
- **Email**: SendGrid, Resend, Postmark (provider-agnostic, BYOK with priority fallback)
- **Payments**: Multi-provider (Paystack for NGN, Polar for USD, with extensible architecture)
- **Containerization**: Docker

---

## Project Structure

```
src/
├── main.ts                               # Entry point — bootstraps the app, Swagger (non-prod)
├── app.module.ts                         # Root module
├── app.controller.ts                     # GET /ping, GET /info
│
├── auth/                                 # Authentication & all guards
│   ├── decorators/
│   │   ├── current-customer.decorator.ts # Extracts customer from request (API key routes)
│   │   ├── ip-rate-limit.decorator.ts    # @IpRateLimit(limit, windowSeconds)
│   │   └── public.decorator.ts           # @Public() — bypasses global JwtAuthGuard
│   ├── guards/
│   │   ├── api-key.guard.ts              # Validates nh_[64hex] API keys
│   │   ├── api-quota.guard.ts            # Monthly notification quota enforcement
│   │   ├── customer-rate-limit.guard.ts  # Per-customer req/min (API key routes)
│   │   ├── ip-rate-limit.guard.ts        # Per-IP req/min (public routes)
│   │   ├── jwt-auth.guard.ts             # JWT validation (registered globally)
│   │   └── roles.guard.ts                # Role-based access (registered globally)
│   ├── strategies/
│   │   ├── github.strategy.ts            # GitHub OAuth
│   │   └── jwt.strategy.ts               # JWT — attaches user + plan to request
│   ├── services/
│   │   ├── session.service.ts            # Access/refresh tokens, rotation, reuse detection, 5-session cap
│   │   ├── otp.service.ts                # Signup/reset codes — atomic check, wrong-guess lock, resend limit
│   │   └── user-provisioning.service.ts  # Email/GitHub user upsert, FREE customer creation, pending signups
│   ├── constants/
│   │   └── auth.constants.ts             # OTP/session limits and TTLs, Redis key builders
│   ├── helpers/
│   │   └── auth.helpers.ts               # normalizeEmail, sanitizeUser
│   ├── auth.controller.ts
│   ├── auth.module.ts
│   └── auth.service.ts                   # Orchestrates each auth flow
│
├── common/
│   ├── constants/
│   │   └── plans.constants.ts            # Plan limits — monthly quota, req/min, retention
│   ├── decorators/
│   │   ├── roles.decorator.ts
│   │   └── user.decorator.ts
│   ├── encryption/
│   │   └── encryption.service.ts         # AES encryption for stored provider API keys + webhook secrets
│   ├── filters/
│   │   └── all-exceptions.filter.ts      # Global exception → { success, error, timestamp }
│   ├── interceptors/
│   │   └── response.interceptor.ts       # Wraps responses → { success, data, timestamp }
│   ├── middleware/
│   │   └── activity-logger.middleware.ts
│   ├── rate-limit/
│   │   └── rate-limit.module.ts          # Provides IpRateLimitGuard
│   ├── slack/
│   │   └── slack.service.ts              # Slack Incoming Webhook alerts (SLACK_WEBHOOK_URL)
│   └── utils/
│       ├── date.util.ts                  # addMonths (calendar-month billing dates)
│       ├── duration.util.ts              # parseDurationMs for "15m" / "7d" style settings
│       ├── enum.util.ts
│       ├── error.util.ts                 # getErrorMessage / getAxiosErrorData / getAxiosErrorStatus /isTransientError
│       ├── hash.util.ts                  # hashToken (sha256) for API keys and refresh tokens
│       └── response.util.ts
│
├── admin/                                # Admin-only endpoints (ADMIN role)
├── billing/                              # Plan upgrades, subscriptions, invoices
├── config/                               # configureApp pipeline, env validation, JWT/cookie/CORS/request-size config
├── platform-email/                       # Internal platform email dispatch + HTML templates
├── health/                               # GET /health, GET /health/simple
├── notifications/                        # Customer-facing API — send email & webhook
├── payment/                              # Paystack & Polar providers + webhook handlers
├── prisma/                               # PrismaService
├── queues/                               # BullMQ workers — email & webhook processors
├── redis/                                # RedisService (ioredis wrapper + remember helper)
├── email-providers/                      # All email provider integrations
│   ├── email-provider.interface.ts       # IEmailProvider interface + SendEmailParams
│   ├── email-provider.factory.ts         # Resolves provider(s) per customer + plan
│   ├── email-providers.module.ts
│   ├── sendgrid/                         # SendGrid send client, domain verification, webhook events + guards
│   ├── resend/                           # Resend send client, domain verification, webhook events + guards
│   └── postmark/                         # Postmark send client, domain verification, webhook events + guards
└── user/                                 # Profile, API key, provider keys, jobs history, domain management
```

---

## Prerequisites

- Node.js 20+ (required by NestJS 11)
- Docker & Docker Compose
- At least one of: SendGrid, Resend, or Postmark account (any combination — used in priority order for the FREE tier)
- A Paystack account (NGN billing) and/or a Polar account (USD billing)

---

## Local Development

### 1. Clone the repository

```bash
git clone https://github.com/brayzonn/notifykit.git
cd notifykit
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Fill in the required values in `.env`:

```env
# App
NODE_ENV=development
PORT=3000

# CORS
# Comma-separated full origins (a literal "*" will NOT work — credentials are enabled)
CORS_ORIGIN=
# Apex domain for wildcard subdomain matching in production; leave blank to disable
ALLOWED_DOMAIN=
FRONTEND_URL=http://localhost:3001
BACKEND_URL=http://localhost:3000

# Request body size limits (optional, default 10mb)
# MAX_JSON_SIZE=10mb
# MAX_FORM_SIZE=10mb

# Encryption
ENCRYPTION_KEY=

# JWT
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
JWT_EXPIRES_IN=3600s
# Optional, defaults to 7d
# JWT_REFRESH_EXPIRES_IN=7d

# Cookies
COOKIE_SECRET=your-cookie-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/auth/github/callback

# Paystack (NGN subscriptions)
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxx
PAYSTACK_INDIE_PLAN_ID=PLN_xxxxxxxxxxxxx
PAYSTACK_STARTUP_PLAN_ID=PLN_xxxxxxxxxxxxx
PAYSTACK_INDIE_AMOUNT=500000
PAYSTACK_STARTUP_AMOUNT=1000000

# Polar (USD subscriptions)
POLAR_ACCESS_TOKEN=polar_oat_...
POLAR_WEBHOOK_SECRET=polar_whs_...
POLAR_SERVER=sandbox
POLAR_INDIE_PRODUCT_ID=
POLAR_STARTUP_PRODUCT_ID=

# Slack (optional — Incoming Webhook URL for platform email failure alerts)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# SendGrid (platform shared key — used for Free plan and as fallback)
SENDGRID_API_KEY=SG....
SENDGRID_FROM_EMAIL=
SENDGRID_WEBHOOK_VERIFICATION_KEY=

# Resend (platform shared key — used as fallback when SendGrid is unavailable)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=
RESEND_WEBHOOK_SECRET=

# Postmark (platform shared key — third-tier fallback for FREE plan)
POSTMARK_API_KEY=
POSTMARK_FROM_EMAIL=
POSTMARK_MESSAGE_STREAM=outbound
POSTMARK_WEBHOOK_SECRET=

# Database
DATABASE_URL=postgresql://notifykit:localdev123@localhost:5432/notifykit
POSTGRES_USER=notifykit
POSTGRES_PASSWORD=localdev123
POSTGRES_DB=notifykit
POSTGRES_PORT=5432
POSTGRES_CONTAINER_NAME=notifykit-postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_CONTAINER_NAME=notifykit-redis
```

The app validates its configuration at startup and refuses to start if something is wrong:

- `JWT_SECRET`, `JWT_REFRESH_SECRET` and `COOKIE_SECRET` must be at least 16 characters.
- `ENCRYPTION_KEY` must be a 64-character hex string.
- `DATABASE_URL` must be set.
- `JWT_EXPIRES_IN` is required, and `JWT_REFRESH_EXPIRES_IN` (if set) must use the same format: a whole number followed by `s`, `m`, `h` or `d`, such as `3600s`, `15m` or `7d`. Plain numbers (`3600`) and other forms (`1w`, `7 days`) are rejected, because the JWT library reads a unitless value as milliseconds.

### 4. Start PostgreSQL and Redis with Docker

```bash
docker-compose -f docker-compose.dev.yml up -d postgres redis
```

### 5. Run database migrations

```bash
npx prisma migrate dev
npx prisma generate
```

### 6. Start the development server

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000/api/v1`.

---

## Production Deployment

### 1. Set up environment variables

```bash
cp .env.example .env.production
```

Fill in production values — use live Paystack/Polar keys, set `POLAR_SERVER=production`, and use a strong `COOKIE_SECRET`. The startup checks listed under [Set up environment variables](#3-set-up-environment-variables) apply here too, so the API container won't start with a missing or malformed value.

### 2. Build and start with Docker Compose

```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

### 3. Run migrations against production database

```bash
docker-compose -f docker-compose.prod.yml exec api npx prisma migrate deploy
```

---

## Viewing Logs

```bash
docker-compose -f docker-compose.prod.yml logs -f api
```

---

## Testing Webhooks Locally

**Paystack** — use ngrok or similar to expose your local server, then set the tunnel URL as the webhook endpoint in your Paystack dashboard.

**Polar** — use the Polar CLI:

```bash
npm install -g @polar-sh/cli
polar login
polar webhooks listen --forward-to localhost:3000/api/v1/payment/polar/webhook
```

This forwards all Polar webhook events to your local server. Use the sandbox dashboard to trigger test events.

---

## API Health Check

```
GET /api/v1/health
```

---

## Key Endpoints

### App

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET    | `/ping`  | Ping        |
| GET    | `/info`  | API info    |

### Auth

| Method | Endpoint                              | Description            |
| ------ | ------------------------------------- | ---------------------- |
| POST   | `/api/v1/auth/signup`                 | Register new account   |
| POST   | `/api/v1/auth/verify-otp`             | Verify email OTP       |
| POST   | `/api/v1/auth/resend-otp`             | Resend OTP             |
| POST   | `/api/v1/auth/signin`                 | Sign in                |
| POST   | `/api/v1/auth/logout`                 | Logout                 |
| POST   | `/api/v1/auth/refresh-token`          | Refresh access token   |
| GET    | `/api/v1/auth/github`                 | GitHub OAuth           |
| GET    | `/api/v1/auth/github/callback`        | GitHub OAuth callback  |
| POST   | `/api/v1/auth/reset-password/request` | Request password reset |
| POST   | `/api/v1/auth/reset-password/confirm` | Confirm password reset |

#### Verification and reset codes

Signup and password reset both use a 6-digit code sent by email.

- A code is valid for 10 minutes and can only be used once.
- After 5 wrong guesses for an email, every guess for that email is refused for 10 minutes (counted from the first wrong guess), including the correct code. Requesting a new code doesn't lift the lock.
- `resend-otp` allows 3 resends per email per 10 minutes. If the email fails to send, the resend isn't counted and the previous code stays valid. Each resend also extends the pending signup by 10 minutes.
- Password reset always returns the same message whether or not the email has an account, and reports a locked code as `Invalid or expired reset code`.

#### Sessions

- Access tokens last `JWT_EXPIRES_IN`. Refresh tokens last `JWT_REFRESH_EXPIRES_IN` (default `7d`) and are set as an httpOnly `refreshToken` cookie.
- `refresh-token` returns a new access token. It also replaces the refresh token once the current one is within 3 days of expiring, or within half its lifetime if that is shorter.
- Each user can have 5 active sessions; signing in again removes the oldest.
- Presenting a refresh token that has already been replaced or revoked signs the user out of every session, since it may have been stolen. A password reset also signs out every session.

### User

| Method | Endpoint                                         | Description                        |
| ------ | ------------------------------------------------ | ---------------------------------- |
| GET    | `/api/v1/user/profile`                           | Get profile                        |
| PATCH  | `/api/v1/user/profile`                           | Update profile                     |
| POST   | `/api/v1/user/change-password`                   | Change password                    |
| POST   | `/api/v1/user/email/change-request`              | Request email change               |
| GET    | `/api/v1/user/dashboard`                         | Get dashboard summary              |
| GET    | `/api/v1/user/api-key`                           | Get API key                        |
| POST   | `/api/v1/user/api-key/generate`                  | Regenerate API key                 |
| GET    | `/api/v1/user/usage`                             | Get usage stats                    |
| GET    | `/api/v1/user/jobs`                              | List jobs                          |
| GET    | `/api/v1/user/jobs/:id`                          | Get job details                    |
| POST   | `/api/v1/user/jobs/:id/retry`                    | Retry job                          |
| GET    | `/api/v1/user/sendgrid-key`                      | Get SendGrid key status            |
| POST   | `/api/v1/user/sendgrid-key`                      | Save SendGrid API key              |
| DELETE | `/api/v1/user/sendgrid-key`                      | Remove SendGrid API key            |
| GET    | `/api/v1/user/resend-key`                        | Get Resend key status              |
| POST   | `/api/v1/user/resend-key`                        | Save Resend API key                |
| DELETE | `/api/v1/user/resend-key`                        | Remove Resend API key              |
| GET    | `/api/v1/user/postmark-key`                      | Get Postmark key status            |
| POST   | `/api/v1/user/postmark-key`                      | Save Postmark Server Token         |
| DELETE | `/api/v1/user/postmark-key`                      | Remove Postmark API key            |
| GET    | `/api/v1/user/sendgrid-webhook-key`              | Get SendGrid webhook secret status |
| POST   | `/api/v1/user/sendgrid-webhook-key`              | Save SendGrid webhook secret       |
| DELETE | `/api/v1/user/sendgrid-webhook-key`              | Remove SendGrid webhook secret     |
| GET    | `/api/v1/user/resend-webhook-key`                | Get Resend webhook secret status   |
| POST   | `/api/v1/user/resend-webhook-key`                | Save Resend webhook secret         |
| DELETE | `/api/v1/user/resend-webhook-key`                | Remove Resend webhook secret       |
| GET    | `/api/v1/user/postmark-webhook-key`              | Get Postmark webhook secret status |
| POST   | `/api/v1/user/postmark-webhook-key`              | Save Postmark webhook secret       |
| DELETE | `/api/v1/user/postmark-webhook-key`              | Remove Postmark webhook secret     |
| GET    | `/api/v1/user/email-provider`                    | List configured providers          |
| PATCH  | `/api/v1/user/email-provider/:provider/priority` | Update provider failover priority  |
| POST   | `/api/v1/user/domain/request`                    | Request domain verification        |
| POST   | `/api/v1/user/domain/verify`                     | Verify domain                      |
| GET    | `/api/v1/user/domain/status`                     | Get domain status                  |
| DELETE | `/api/v1/user/domain`                            | Remove domain                      |
| POST   | `/api/v1/user/webhook-secret`                    | Generate webhook signing secret    |
| GET    | `/api/v1/user/webhook-secret`                    | Get signing secret status          |
| POST   | `/api/v1/user/webhook-secret/rotate`             | Rotate webhook signing secret      |
| DELETE | `/api/v1/user/webhook-secret`                    | Delete webhook signing secret      |
| DELETE | `/api/v1/user/account`                           | Delete account                     |

### Billing

| Method | Endpoint                       | Description              |
| ------ | ------------------------------ | ------------------------ |
| POST   | `/api/v1/billing/upgrade`      | Upgrade plan             |
| POST   | `/api/v1/billing/cancel`       | Cancel subscription      |
| GET    | `/api/v1/billing/subscription` | Get subscription details |
| GET    | `/api/v1/billing/invoices`     | Get invoices             |
| GET    | `/api/v1/payment/methods`      | Get payment methods      |

### Notifications (API Key auth)

| Method | Endpoint                               | Description               |
| ------ | -------------------------------------- | ------------------------- |
| POST   | `/api/v1/notifications/email`          | Send email notification   |
| POST   | `/api/v1/notifications/webhook`        | Send webhook notification |
| GET    | `/api/v1/notifications/jobs`           | List notification jobs    |
| GET    | `/api/v1/notifications/jobs/:id`       | Get job status            |
| POST   | `/api/v1/notifications/jobs/:id/retry` | Retry failed job          |

#### Per-message provider routing (paid plans)

`POST /api/v1/notifications/email` accepts two optional fields that override the customer's default priority order for a single message:

| Field      | Type                                   | Behavior                                                                                             |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `provider` | `"SENDGRID" \| "RESEND" \| "POSTMARK"` | Forced routing is a contract: BullMQ does not retry through providers the customer didn't authorize. |
| `fallback` | `"SENDGRID" \| "RESEND" \| "POSTMARK"` | Optional second provider tried only if `provider` fails. Other configured providers are not tried.   |

Validation:

| Condition                                         | Response          |
| ------------------------------------------------- | ----------------- |
| `fallback` set without `provider`                 | `400 Bad Request` |
| `provider` equals `fallback`                      | `400 Bad Request` |
| Either field used by a `FREE` plan customer       | `403 Forbidden`   |
| Requested `provider` or `fallback` not configured | `400 Bad Request` |

Forced routing is a contract: BullMQ does **not** retry through providers the customer didn't authorize. Routing fields persist with the job, so manual or automatic retries replay the same attempt set.

When neither field is set, behavior is unchanged: the worker tries the customer's full priority list with full failover.

#### Webhook HMAC signing

If a customer has configured a webhook signing secret, every outgoing webhook delivery includes two additional headers:

| Header                | Value                           |
| --------------------- | ------------------------------- |
| `X-Webhook-Timestamp` | Unix timestamp (seconds)        |
| `X-Webhook-Signature` | `t=<timestamp>,v1=<sha256_hex>` |

The signature is computed as `HMAC-SHA256(timestamp + "." + JSON.stringify(payload), secret)`. Customers should verify it at their endpoint by recomputing the signature and comparing using a constant-time comparison. If no secret is configured, these headers are omitted and delivery proceeds unsigned.

Secrets are managed via the `/api/v1/user/webhook-secret` endpoints (JWT auth). They are stored encrypted at rest using AES-256-GCM. The plaintext secret is returned only at generation time (prefixed `whsec_`); subsequent calls to `GET /webhook-secret` return status only.

#### `usedProvider` on delivery logs

Every entry in the `deliveryLogs[]` array on `GET /api/v1/notifications/jobs/:id` and `GET /api/v1/user/jobs/:id` now includes a `usedProvider` field (`"SENDGRID" \| "RESEND" \| "POSTMARK" \| null`). Success rows record the provider that delivered the email; failure rows record the last provider attempted. Pre-attempt failures and rows that pre-date the migration are `null`.

### Admin (ADMIN role required)

| Method | Endpoint                                  | Description                    |
| ------ | ----------------------------------------- | ------------------------------ |
| GET    | `/api/v1/admin/users`                     | List all users (paginated)     |
| GET    | `/api/v1/admin/users/:id`                 | Get user details               |
| PATCH  | `/api/v1/admin/users/:id`                 | Update user                    |
| DELETE | `/api/v1/admin/users/:id`                 | Soft delete user               |
| POST   | `/api/v1/admin/users/:id/restore`         | Restore soft-deleted user      |
| DELETE | `/api/v1/admin/users/:id/permanent`       | Permanently delete user        |
| GET    | `/api/v1/admin/customers`                 | List all customers (paginated) |
| GET    | `/api/v1/admin/customers/:id`             | Get customer with jobs summary |
| PATCH  | `/api/v1/admin/customers/:id/plan`        | Update customer plan           |
| PATCH  | `/api/v1/admin/customers/:id/usage-reset` | Reset customer usage           |
| GET    | `/api/v1/admin/jobs`                      | List all jobs (paginated)      |
| DELETE | `/api/v1/admin/jobs/:id`                  | Hard delete job                |
| GET    | `/api/v1/admin/domains`                   | List all sending domains       |
| GET    | `/api/v1/admin/stats`                     | Get system-wide statistics     |

### Health

| Method | Endpoint                | Description         |
| ------ | ----------------------- | ------------------- |
| GET    | `/api/v1/health`        | Full health check   |
| GET    | `/api/v1/health/simple` | Simple health check |

### Webhooks

| Method | Endpoint                                | Description                                             |
| ------ | --------------------------------------- | ------------------------------------------------------- |
| POST   | `/api/v1/payment/paystack/webhook`      | Paystack webhook handler                                |
| POST   | `/api/v1/payment/polar/webhook`         | Polar webhook handler                                   |
| POST   | `/api/v1/webhooks/sendgrid`             | SendGrid email events (shared platform key, ECDSA)      |
| POST   | `/api/v1/webhooks/sendgrid/:customerId` | SendGrid email events (per-customer key, ECDSA)         |
| POST   | `/api/v1/webhooks/resend/:customerId`   | Resend email events (per-customer secret, svix)         |
| POST   | `/api/v1/webhooks/postmark/:customerId` | Postmark email events (per-customer secret, Basic Auth) |

---

## Rate Limiting

All routes have rate limiting. Two guard types are in use:

- **`IpRateLimitGuard`** — IP-based. Keyed by `{client-ip}:{handler}` in Redis. Reads the limit from the `@IpRateLimit()` decorator on the handler or controller.
- **`CustomerRateLimitGuard`** — identity-based, applied to API key routes (`/notifications/*`). Keyed by customer ID. Limit is determined by the customer's plan.

All guards use an atomic Redis Lua script (INCR + EXPIRE) with a 60-second window. On Redis failure all guards fail open (allow the request) and log an error.

### Rate limit table

| Endpoint(s)                                     | Guard                    | Limit       | Key         |
| ----------------------------------------------- | ------------------------ | ----------- | ----------- |
| `GET /ping`, `GET /info`                        | `IpRateLimitGuard`       | 60 req/min  | IP          |
| `GET /health`                                   | `IpRateLimitGuard`       | 20 req/min  | IP          |
| `GET /health/simple`                            | `IpRateLimitGuard`       | 30 req/min  | IP          |
| `POST /auth/signup`                             | `IpRateLimitGuard`       | 5 req/min   | IP          |
| `POST /auth/signin`                             | `IpRateLimitGuard`       | 10 req/min  | IP          |
| `POST /auth/verify-otp`                         | `IpRateLimitGuard`       | 5 req/min   | IP          |
| `POST /auth/resend-otp`                         | `IpRateLimitGuard`       | 3 req/min   | IP          |
| `POST /auth/refresh-token`                      | `IpRateLimitGuard`       | 30 req/min  | IP          |
| `POST /auth/reset-password/request`             | `IpRateLimitGuard`       | 5 req/min   | IP          |
| `POST /auth/reset-password/confirm`             | `IpRateLimitGuard`       | 10 req/min  | IP          |
| `GET /auth/github`, `GET /auth/github/callback` | `IpRateLimitGuard`       | 20 req/min  | IP          |
| `POST /auth/logout`                             | `IpRateLimitGuard`       | 20 req/min  | IP          |
| `POST /payment/paystack/webhook`                | `IpRateLimitGuard`       | 300 req/min | IP          |
| `POST /payment/polar/webhook`                   | `IpRateLimitGuard`       | 300 req/min | IP          |
| `POST /user/email/verify-new/:token`            | `IpRateLimitGuard`       | 20 req/min  | IP          |
| `POST /user/email/confirm-old/:token`           | `IpRateLimitGuard`       | 20 req/min  | IP          |
| `POST /user/email/cancel/:token`                | `IpRateLimitGuard`       | 20 req/min  | IP          |
| All `/user/*` JWT routes                        | `IpRateLimitGuard`       | 120 req/min | IP          |
| All `/billing/*` routes                         | `IpRateLimitGuard`       | 60 req/min  | IP          |
| `GET /payment/methods`                          | `IpRateLimitGuard`       | 60 req/min  | IP          |
| All `/admin/*` routes                           | `IpRateLimitGuard`       | 300 req/min | IP          |
| All `/notifications/*` routes                   | `CustomerRateLimitGuard` | Plan-based  | Customer ID |

### Plan-based limits (req/min) — `/notifications/*`

| Plan    | `/notifications/*` |
| ------- | ------------------ |
| FREE    | 5                  |
| INDIE   | 50                 |
| STARTUP | 200                |

> **Behind a proxy:** the app trusts one proxy hop (`trust proxy` is `1`), so `IpRateLimitGuard` keys on the client address reported by the nearest proxy in `X-Forwarded-For`. Run exactly one proxy in front of the API (e.g. nginx). With a second layer such as a CDN in front of it, every request appears to come from the CDN's addresses and shares their limits.

---

## Testing

This project includes Jest unit and e2e suites covering:

- **Auth & guards**: signin, password reset, token refresh and rotation, session limits, logout, OTP lockout and resend limits, API key validation, quota enforcement, JWT/IP/customer rate limiting
- **Config**: startup env validation, duration parsing, refresh cookie lifetime
- **Email providers**: SendGrid, Resend, and Postmark send services + domain verification services + the shared `EmailProviderFactory` (FREE-tier fallback order, paid-tier per-customer resolution)
- **Webhook receivers**: SendGrid / Resend / Postmark signature guards (ECDSA, svix, Basic Auth respectively) and event-type mapping for each provider
- **Payment webhooks**: Paystack signature verification, subscription events, payment-failure handling
- **Queue processors**: email/webhook job processing, multi-provider failover, retry logic
- **E2E**: complete signup → verify → signin flow, password reset, refresh-token rotation, session limits, OTP resend, OTP lockout, parallel-guess and double-submit races

Run tests with:

```bash
# All unit tests
npm run test

# With coverage
npm run test:cov

# E2E tests (needs PostgreSQL and Redis running; cleanup deletes all
# customers and refresh tokens, so point .env at a disposable database)
npm run test:e2e

# Watch mode
npm run test:watch
```

See [TEST_SUMMARY.md](./TEST_SUMMARY.md) for detailed test documentation.

---

## License

[MIT](./LICENSE) © 2026 Eyinda Bright
