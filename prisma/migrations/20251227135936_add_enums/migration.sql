/*
  Warnings:

  - The `plan` column on the `customers` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `jobs` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `status` on the `delivery_logs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `type` on the `jobs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "CustomerPlan" AS ENUM ('FREE', 'INDIE', 'STARTUP');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('EMAIL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "customers" DROP COLUMN "plan",
ADD COLUMN     "plan" "CustomerPlan" NOT NULL DEFAULT 'FREE';

-- AlterTable
ALTER TABLE "delivery_logs" DROP COLUMN "status",
ADD COLUMN     "status" "DeliveryStatus" NOT NULL;

-- AlterTable
ALTER TABLE "jobs" DROP COLUMN "type",
ADD COLUMN     "type" "JobType" NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "JobStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_type_idx" ON "jobs"("type");
