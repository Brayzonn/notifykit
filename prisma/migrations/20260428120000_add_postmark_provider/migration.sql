-- Add POSTMARK to EmailProviderType enum
ALTER TYPE "EmailProviderType" ADD VALUE 'POSTMARK';

-- Add nullable account-level API key column for providers that split server vs account credentials (Postmark)
ALTER TABLE "customer_email_providers" ADD COLUMN "account_api_key" TEXT;
