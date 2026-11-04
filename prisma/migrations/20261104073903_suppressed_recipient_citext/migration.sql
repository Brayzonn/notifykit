-- Enable case-insensitive text type
CREATE EXTENSION IF NOT EXISTS citext;

-- AlterTable
ALTER TABLE "suppressed_recipients" ALTER COLUMN "email" SET DATA TYPE CITEXT;
