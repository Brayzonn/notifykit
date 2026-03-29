-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "resend_api_key" TEXT,
ADD COLUMN     "resend_key_added_at" TIMESTAMP(3);
