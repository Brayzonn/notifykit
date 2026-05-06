/*
  Warnings:

  - A unique constraint covering the columns `[provider_customer_id]` on the table `customers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[provider_subscription_id]` on the table `customers` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "customers_provider_subscription_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "customers_provider_customer_id_key" ON "customers"("provider_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_provider_subscription_id_key" ON "customers"("provider_subscription_id");
