/*
  Warnings:

  - You are about to drop the column `email_provider` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `resend_api_key` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `resend_key_added_at` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `sendgrid_api_key` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `sendgrid_key_added_at` on the `customers` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "customers" DROP COLUMN "email_provider",
DROP COLUMN "resend_api_key",
DROP COLUMN "resend_key_added_at",
DROP COLUMN "sendgrid_api_key",
DROP COLUMN "sendgrid_key_added_at";

-- CreateTable
CREATE TABLE "customer_email_providers" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "provider" "EmailProviderType" NOT NULL,
    "api_key" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_email_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_email_providers_customer_id_priority_idx" ON "customer_email_providers"("customer_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "customer_email_providers_customer_id_provider_key" ON "customer_email_providers"("customer_id", "provider");

-- AddForeignKey
ALTER TABLE "customer_email_providers" ADD CONSTRAINT "customer_email_providers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
