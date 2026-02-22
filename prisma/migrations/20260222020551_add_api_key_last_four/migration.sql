-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "api_key_last_four" TEXT,
ALTER COLUMN "monthly_limit" DROP DEFAULT;
