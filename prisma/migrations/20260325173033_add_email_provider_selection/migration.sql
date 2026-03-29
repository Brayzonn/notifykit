-- CreateEnum
CREATE TYPE "EmailProviderType" AS ENUM ('SENDGRID', 'RESEND');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "email_provider" "EmailProviderType";
