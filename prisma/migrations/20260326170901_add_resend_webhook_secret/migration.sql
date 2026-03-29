-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "resend_webhook_secret" TEXT,
ADD COLUMN     "resend_webhook_secret_added_at" TIMESTAMP(3);
