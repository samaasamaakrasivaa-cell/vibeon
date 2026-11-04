-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'lessons',
ADD COLUMN     "lessonIds" TEXT[],
ADD COLUMN     "packLessons" INTEGER,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "payerContact" TEXT,
ADD COLUMN     "payerName" TEXT,
ADD COLUMN     "proofAt" TIMESTAMP(3),
ADD COLUMN     "remindCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remindedAt" TIMESTAMP(3),
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "LessonInstance" ADD COLUMN     "billedAt" TIMESTAMP(3),
ADD COLUMN     "deductedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Invoice_status_createdAt_idx" ON "Invoice"("status", "createdAt");
