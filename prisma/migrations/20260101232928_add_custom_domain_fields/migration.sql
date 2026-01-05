/*
  Warnings:

  - A unique constraint covering the columns `[sendgrid_domain_id]` on the table `customers` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "domain_dns_records" JSONB,
ADD COLUMN     "domain_requested_at" TIMESTAMP(3),
ADD COLUMN     "domain_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "domain_verified_at" TIMESTAMP(3),
ADD COLUMN     "sendgrid_domain_id" TEXT,
ADD COLUMN     "sending_domain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "customers_sendgrid_domain_id_key" ON "customers"("sendgrid_domain_id");
