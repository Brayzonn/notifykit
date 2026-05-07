-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "webhook_signing_secret" TEXT,
ADD COLUMN     "webhook_signing_secret_at" TIMESTAMP(3);
