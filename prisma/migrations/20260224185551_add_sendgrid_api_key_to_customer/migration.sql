-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "sendgrid_api_key" TEXT,
ADD COLUMN     "sendgrid_key_added_at" TIMESTAMP(3);
