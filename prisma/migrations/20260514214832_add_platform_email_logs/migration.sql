-- CreateEnum
CREATE TYPE "PlatformEmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "platform_email_logs" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "PlatformEmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_email_logs_label_idx" ON "platform_email_logs"("label");

-- CreateIndex
CREATE INDEX "platform_email_logs_to_idx" ON "platform_email_logs"("to");

-- CreateIndex
CREATE INDEX "platform_email_logs_status_idx" ON "platform_email_logs"("status");

-- CreateIndex
CREATE INDEX "platform_email_logs_created_at_idx" ON "platform_email_logs"("created_at" DESC);
