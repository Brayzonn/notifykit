-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "downgraded_at" TIMESTAMP(3),
ADD COLUMN     "previous_plan" "CustomerPlan";
