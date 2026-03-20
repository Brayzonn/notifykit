-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "sendgrid_webhook_key" TEXT,
ADD COLUMN     "sendgrid_webhook_key_added_at" TIMESTAMP(3);
