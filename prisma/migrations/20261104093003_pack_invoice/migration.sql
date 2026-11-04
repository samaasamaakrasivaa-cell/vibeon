
-- AlterTable
ALTER TABLE "Pack" ADD COLUMN     "invoiceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pack_invoiceId_key" ON "Pack"("invoiceId");

