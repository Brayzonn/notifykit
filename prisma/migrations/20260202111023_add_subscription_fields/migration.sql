-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PADDLE', 'PAYSTACK', 'FLUTTERWAVE', 'LEMONSQUEEZY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'TRIALING');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "last_payment_date" TIMESTAMP(3),
ADD COLUMN     "next_billing_date" TIMESTAMP(3),
ADD COLUMN     "payment_metadata" JSONB,
ADD COLUMN     "payment_provider" "PaymentProvider",
ADD COLUMN     "provider_customer_id" TEXT,
ADD COLUMN     "provider_subscription_id" TEXT,
ADD COLUMN     "subscription_end_date" TIMESTAMP(3),
ADD COLUMN     "subscription_status" "SubscriptionStatus";

-- CreateIndex
CREATE INDEX "customers_subscription_status_idx" ON "customers"("subscription_status");

-- CreateIndex
CREATE INDEX "customers_provider_subscription_id_idx" ON "customers"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "customers_payment_provider_idx" ON "customers"("payment_provider");
