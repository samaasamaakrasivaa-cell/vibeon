BEGIN;
ALTER TABLE "Upload" ADD COLUMN "paymentArtifact" JSONB;

CREATE TABLE "InvoiceDocumentVersion" (
    "uploadId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "PaymentDocumentKind" NOT NULL,
    "previous" TEXT,
    "actorId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restored" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "InvoiceDocumentVersion_pkey" PRIMARY KEY ("uploadId"),
    CONSTRAINT "InvoiceDocumentVersion_invoiceId_fkey" FOREIGN KEY ("invoiceId")
        REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "InvoiceDocumentVersion_invoiceId_changedAt_idx" ON "InvoiceDocumentVersion"("invoiceId", "changedAt");

CREATE TABLE "PaymentOcrAttempt" (
    "uploadId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "matches" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "PaymentOcrAttempt_pkey" PRIMARY KEY ("uploadId")
);
COMMIT;
