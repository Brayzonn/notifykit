-- Remove provider-specific webhook secret columns from customers
ALTER TABLE "customers" DROP COLUMN IF EXISTS "sendgrid_webhook_key";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "sendgrid_webhook_key_added_at";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "resend_webhook_secret";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "resend_webhook_secret_added_at";

-- Remove domain columns from customers
ALTER TABLE "customers" DROP COLUMN IF EXISTS "sending_domain";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "domain_verified";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "sendgrid_domain_id";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "domain_dns_records";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "domain_requested_at";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "domain_verified_at";

-- Add webhook secret to customer_email_providers
ALTER TABLE "customer_email_providers"
  ADD COLUMN "webhook_secret" TEXT,
  ADD COLUMN "webhook_secret_added_at" TIMESTAMP(3);

-- Create customer_sending_domains table
CREATE TABLE "customer_sending_domains" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "customer_id"        UUID NOT NULL,
  "domain"             TEXT NOT NULL,
  "provider"           "EmailProviderType" NOT NULL,
  "provider_domain_id" TEXT,
  "dns_records"        JSONB,
  "verified"           BOOLEAN NOT NULL DEFAULT false,
  "requested_at"       TIMESTAMP(3) NOT NULL,
  "verified_at"        TIMESTAMP(3),

  CONSTRAINT "customer_sending_domains_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customer_sending_domains"
  ADD CONSTRAINT "customer_sending_domains_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "customer_sending_domains_customer_id_domain_provider_key"
  ON "customer_sending_domains"("customer_id", "domain", "provider");

CREATE INDEX "customer_sending_domains_customer_id_idx"
  ON "customer_sending_domains"("customer_id");

-- Add provider column to email_events
ALTER TABLE "email_events"
  ADD COLUMN "provider" "EmailProviderType";
