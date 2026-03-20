-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'SPAM_REPORT', 'UNSUBSCRIBED', 'DEFERRED');

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "familyId" DROP DEFAULT;

-- CreateTable
CREATE TABLE "email_events" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "event" "EmailEventType" NOT NULL,
    "email" TEXT NOT NULL,
    "sg_event_id" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_events_sg_event_id_key" ON "email_events"("sg_event_id");

-- CreateIndex
CREATE INDEX "email_events_job_id_idx" ON "email_events"("job_id");

-- CreateIndex
CREATE INDEX "email_events_event_idx" ON "email_events"("event");

-- CreateIndex
CREATE INDEX "email_events_occurred_at_idx" ON "email_events"("occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
