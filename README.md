# NotifyKit API

The backend API for [NotifyKit](https://notifykit.dev) — notification infrastructure for modern products.

---

## Tech Stack

- **Framework**: NestJS
- **Database**: PostgreSQL + Prisma ORM
- **Cache/Queue**: Redis
- **Auth**: JWT (access + refresh tokens), GitHub OAuth
- **Email**: SendGrid, Resend, Postmark (provider-agnostic, BYOK with priority fallback)
- **Payments**: Multi-provider (Stripe, Paystack, with extensible architecture)
- **Containerization**: Docker

---

## Project Structure

```
src/
├── main.ts                               # Entry point — global pipes, filters, interceptors
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
│   │   ├── roles.guard.ts                # Role-based access (registered globally)
│   │   └── user-rate-limit.guard.ts      # Per-user req/min (JWT dashboard routes)
│   ├── strategies/
│   │   ├── github.strategy.ts            # GitHub OAuth
│   │   └── jwt.strategy.ts               # JWT — attaches user + plan to request
│   ├── auth.controller.ts
│   ├── auth.module.ts
│   └── auth.service.ts
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
│   │   └── rate-limit.module.ts          # Provides IpRateLimitGuard + UserRateLimitGuard
│   └── utils/
│       ├── enum.util.ts
│       ├── error.util.ts                 # getErrorMessage / getAxiosErrorData / getAxiosErrorStatus
│       └── response.util.ts
│
├── admin/                                # Admin-only endpoints (ADMIN role)
├── billing/                              # Plan upgrades, subscriptions, invoices
├── config/                               # Cookie, CORS, validation, request-size config
├── email/                                # Internal email dispatch + HTML templates
├── health/                               # GET /health, GET /health/simple
├── notifications/                        # Customer-facing API — send email & webhook
├── payment/                              # Stripe & Paystack providers + webhook handlers
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

- Node.js 18+
- Docker & Docker Compose
- At least one of: SendGrid, Resend, or Postmark account (any combination — used in priority order for the FREE tier)
- A Stripe account

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
CORS_ORIGIN=*
ALLOWED_DOMAIN=*
FRONTEND_URL=http://localhost:3001

#Encryption
ENCRYPTION_KEY=

# JWT
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
JWT_EXPIRES_IN=3600s

# Cookies
COOKIE_SECRET=your-cookie-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/auth/github/callback

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_INDIE_PRICE_ID=price_...
STRIPE_STARTUP_PRICE_ID=price_...

# Paystack
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxx
PAYSTACK_INDIE_PLAN_ID=PLN_xxxxxxxxxxxxx
PAYSTACK_STARTUP_PLAN_ID=PLN_xxxxxxxxxxxxx

# SendGrid (platform shared key — used for Free plan and as fallback)
SENDGRID_API_KEY=SG....
SENDGRID_FROM_EMAIL=
SENDGRID_FROM_NAME=

# Resend (platform shared key — used as fallback when SendGrid is unavailable)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=

# Postmark (platform shared key — third-tier fallback for FREE plan)
POSTMARK_API_KEY=
POSTMARK_FROM_EMAIL=
POSTMARK_MESSAGE_STREAM=outbound

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

# Rate Limiting
RATE_LIMIT_PER_MINUTE=100

# Admin
ADMIN_EMAIL=your-admin-email
```

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

Fill in production values — make sure to use live Stripe keys and a strong `COOKIE_SECRET`.

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

## Testing Stripe Webhooks Locally

Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) then run:

```bash
stripe listen --forward-to localhost:3000/api/v1/payment/stripe/webhook
```

Copy the webhook signing secret it outputs and set it as `STRIPE_WEBHOOK_SECRET` in your `.env.development`.

**Test cards:**

| Scenario           | Card Number           |
| ------------------ | --------------------- |
| Successful payment | `4242 4242 4242 4242` |
| Card declined      | `4000 0000 0000 0002` |
| Requires 3D Secure | `4000 0025 0000 3155` |
| Insufficient funds | `4000 0000 0000 9995` |

Use any future expiry, any CVC, any billing zip.

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

### User

| Method | Endpoint                            | Description                 |
| ------ | ----------------------------------- | --------------------------- |
| GET    | `/api/v1/user/profile`              | Get profile                 |
| PATCH  | `/api/v1/user/profile`              | Update profile              |
| POST   | `/api/v1/user/change-password`      | Change password             |
| POST   | `/api/v1/user/email/change-request` | Request email change        |
| GET    | `/api/v1/user/dashboard`            | Get dashboard summary       |
| GET    | `/api/v1/user/api-key`              | Get API key                 |
| POST   | `/api/v1/user/api-key/generate`     | Regenerate API key          |
| GET    | `/api/v1/user/usage`                | Get usage stats             |
| GET    | `/api/v1/user/jobs`                 | List jobs                   |
| GET    | `/api/v1/user/jobs/:id`             | Get job details             |
| POST   | `/api/v1/user/jobs/:id/retry`       | Retry job                   |
| GET    | `/api/v1/user/sendgrid-key`                            | Get SendGrid key status            |
| POST   | `/api/v1/user/sendgrid-key`                            | Save SendGrid API key              |
| DELETE | `/api/v1/user/sendgrid-key`                            | Remove SendGrid API key            |
| GET    | `/api/v1/user/resend-key`                              | Get Resend key status              |
| POST   | `/api/v1/user/resend-key`                              | Save Resend API key                |
| DELETE | `/api/v1/user/resend-key`                              | Remove Resend API key              |
| GET    | `/api/v1/user/postmark-key`                            | Get Postmark key status            |
| POST   | `/api/v1/user/postmark-key`                            | Save Postmark Server Token         |
| DELETE | `/api/v1/user/postmark-key`                            | Remove Postmark API key            |
| GET    | `/api/v1/user/sendgrid-webhook-key`                    | Get SendGrid webhook secret status |
| POST   | `/api/v1/user/sendgrid-webhook-key`                    | Save SendGrid webhook secret       |
| DELETE | `/api/v1/user/sendgrid-webhook-key`                    | Remove SendGrid webhook secret     |
| GET    | `/api/v1/user/resend-webhook-key`                      | Get Resend webhook secret status   |
| POST   | `/api/v1/user/resend-webhook-key`                      | Save Resend webhook secret         |
| DELETE | `/api/v1/user/resend-webhook-key`                      | Remove Resend webhook secret       |
| GET    | `/api/v1/user/postmark-webhook-key`                    | Get Postmark webhook secret status |
| POST   | `/api/v1/user/postmark-webhook-key`                    | Save Postmark webhook secret       |
| DELETE | `/api/v1/user/postmark-webhook-key`                    | Remove Postmark webhook secret     |
| GET    | `/api/v1/user/email-provider`                          | List configured providers          |
| PATCH  | `/api/v1/user/email-provider/:provider/priority`       | Update provider failover priority  |
| POST   | `/api/v1/user/domain/request`                          | Request domain verification        |
| POST   | `/api/v1/user/domain/verify`                           | Verify domain                      |
| GET    | `/api/v1/user/domain/status`                           | Get domain status                  |
| DELETE | `/api/v1/user/domain`                                  | Remove domain                      |
| POST   | `/api/v1/user/webhook-secret`                          | Generate webhook signing secret    |
| GET    | `/api/v1/user/webhook-secret`                          | Get signing secret status          |
| POST   | `/api/v1/user/webhook-secret/rotate`                   | Rotate webhook signing secret      |
| DELETE | `/api/v1/user/webhook-secret`                          | Delete webhook signing secret      |
| DELETE | `/api/v1/user/account`                                 | Delete account                     |

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

| Field      | Type                                    | Behavior                                                                                                                  |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `provider` | `"SENDGRID" \| "RESEND" \| "POSTMARK"`  | Force this email through a specific configured provider. If it fails and `fallback` is unset, the job fails — no retry.  |
| `fallback` | `"SENDGRID" \| "RESEND" \| "POSTMARK"`  | Optional second provider tried only if `provider` fails. Other configured providers are not tried.                       |

Validation:

| Condition                                                  | Response             |
| ---------------------------------------------------------- | -------------------- |
| `fallback` set without `provider`                          | `400 Bad Request`    |
| `provider` equals `fallback`                               | `400 Bad Request`    |
| Either field used by a `FREE` plan customer                | `403 Forbidden`      |
| Requested `provider` or `fallback` not configured          | `400 Bad Request`    |

Forced routing is a contract: BullMQ does **not** retry through providers the customer didn't authorize. Routing fields persist with the job, so manual or automatic retries replay the same attempt set.

When neither field is set, behavior is unchanged: the worker tries the customer's full priority list with full failover.

#### Webhook HMAC signing

If a customer has configured a webhook signing secret, every outgoing webhook delivery includes two additional headers:

| Header                  | Value                            |
| ----------------------- | -------------------------------- |
| `X-Webhook-Timestamp`   | Unix timestamp (seconds)         |
| `X-Webhook-Signature`   | `t=<timestamp>,v1=<sha256_hex>`  |

The signature is computed as `HMAC-SHA256(timestamp + "." + JSON.stringify(payload), secret)`. Customers should verify it at their endpoint by recomputing the signature and comparing using a constant-time comparison. If no secret is configured, these headers are omitted and delivery proceeds unsigned.

Secrets are managed via the `/api/v1/user/webhook-secret` endpoints (JWT auth). They are stored encrypted at rest using AES-256-CBC. The plaintext secret is returned only at generation time (prefixed `whsec_`); subsequent calls to `GET /webhook-secret` return status only.

#### `usedProvider` on delivery logs

Every entry in the `deliveryLogs[]` array on `GET /api/v1/notifications/jobs/:id` and `GET /api/v1/user/jobs/:id` now includes a `usedProvider` field (`"SENDGRID" \| "RESEND" \| "POSTMARK" \| null`). Success rows record the provider that delivered the email; failure rows record the last provider attempted. Pre-attempt failures and rows that pre-date the migration are `null`.

### Admin (ADMIN role required)

| Method | Endpoint                                  | Description                    |
| ------ | ----------------------------------------- | ------------------------------ |
| GET    | `/api/v1/admin/users`                     | List all users (paginated)     |
| GET    | `/api/v1/admin/users/:id`                 | Get user details               |
| PATCH  | `/api/v1/admin/users/:id`                 | Update user                    |
| DELETE | `/api/v1/admin/users/:id`                 | Soft delete user               |
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

| Method | Endpoint                                  | Description                                              |
| ------ | ----------------------------------------- | -------------------------------------------------------- |
| POST   | `/api/v1/payment/stripe/webhook`          | Stripe webhook handler                                   |
| POST   | `/api/v1/payment/paystack/webhook`        | Paystack webhook handler                                 |
| POST   | `/api/v1/webhooks/sendgrid`               | SendGrid email events (shared platform key, ECDSA)       |
| POST   | `/api/v1/webhooks/sendgrid/:customerId`   | SendGrid email events (per-customer key, ECDSA)          |
| POST   | `/api/v1/webhooks/resend/:customerId`     | Resend email events (per-customer secret, svix)          |
| POST   | `/api/v1/webhooks/postmark/:customerId`   | Postmark email events (per-customer secret, Basic Auth)  |

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
| `POST /payment/stripe/webhook`                  | `IpRateLimitGuard`       | 300 req/min | IP          |
| `POST /payment/paystack/webhook`                | `IpRateLimitGuard`       | 300 req/min | IP          |
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

> **Behind a proxy:** `IpRateLimitGuard` reads `X-Forwarded-For` (first hop) before falling back to `req.ip`. Ensure your proxy sets this header correctly to avoid all traffic being keyed to a single IP.

---

## Testing

This project includes a Jest test suite with 440+ unit tests and 37 e2e scenarios covering:

- **Auth & guards**: signin, password reset, token refresh, logout, API key validation, quota enforcement, JWT/IP/customer rate limiting
- **Email providers**: SendGrid, Resend, and Postmark send services + domain verification services + the shared `EmailProviderFactory` (FREE-tier fallback order, paid-tier per-customer resolution)
- **Webhook receivers**: SendGrid / Resend / Postmark signature guards (ECDSA, svix, Basic Auth respectively) and event-type mapping for each provider
- **Stripe & Paystack webhooks**: signature verification, subscription events, payment handling
- **Queue processors**: email/webhook job processing, multi-provider failover, retry logic
- **E2E**: complete signup → verify → signin flow, password reset, refresh-token rotation, session limits, OTP resend

Run tests with:

```bash
# All unit tests
npm run test

# With coverage
npm run test:cov

# E2E tests
npm run test:e2e

# Watch mode
npm run test:watch
```

See [TEST_SUMMARY.md](./TEST_SUMMARY.md) for detailed test documentation.

---

## License

[MIT](./LICENSE) © 2026 Eyinda Bright
