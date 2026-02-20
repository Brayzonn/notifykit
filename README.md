# NotifyKit API

The backend API for [NotifyKit](https://notifykit.dev) — notification infrastructure for modern products.

---

## Tech Stack

- **Framework**: NestJS
- **Database**: PostgreSQL + Prisma ORM
- **Cache/Queue**: Redis
- **Auth**: JWT (access + refresh tokens), GitHub OAuth
- **Email**: SendGrid
- **Payments**: Stripe
- **Containerization**: Docker

---

## Prerequisites

- Node.js 18+
- Docker & Docker Compose
- A SendGrid account
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

# SendGrid
SENDGRID_API_KEY=SG....
SENDGRID_FROM_EMAIL=noreply@notifykit.dev
SENDGRID_FROM_NAME=NotifyKit

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
| POST   | `/api/v1/user/domain/request`       | Request domain verification |
| POST   | `/api/v1/user/domain/verify`        | Verify domain               |
| GET    | `/api/v1/user/domain/status`        | Get domain status           |
| DELETE | `/api/v1/user/domain`               | Remove domain               |
| DELETE | `/api/v1/user/account`              | Delete account              |

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

### Health

| Method | Endpoint                | Description         |
| ------ | ----------------------- | ------------------- |
| GET    | `/api/v1/health`        | Full health check   |
| GET    | `/api/v1/health/simple` | Simple health check |

### Webhooks

| Method | Endpoint                         | Description            |
| ------ | -------------------------------- | ---------------------- |
| POST   | `/api/v1/payment/stripe/webhook` | Stripe webhook handler |

---

## License

MIT
