-- AlterTable
ALTER TABLE "customer_sending_domains" ALTER COLUMN "id" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "email_events_sg_event_id_key" RENAME TO "email_events_event_id_key";
