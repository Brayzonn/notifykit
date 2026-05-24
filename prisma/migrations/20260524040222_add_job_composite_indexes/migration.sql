-- DropIndex
DROP INDEX "jobs_customer_id_idx";

-- CreateIndex
CREATE INDEX "jobs_customer_id_created_at_idx" ON "jobs"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_customer_id_status_created_at_idx" ON "jobs"("customer_id", "status", "created_at" DESC);
