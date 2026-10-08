-- CreateTable
CREATE TABLE "suppressed_recipients" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "EmailEventType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppressed_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppressed_recipients_customer_id_email_key" ON "suppressed_recipients"("customer_id", "email");

-- AddForeignKey
ALTER TABLE "suppressed_recipients" ADD CONSTRAINT "suppressed_recipients_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
