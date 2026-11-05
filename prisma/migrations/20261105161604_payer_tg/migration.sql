-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "payerChatId" TEXT,
ADD COLUMN     "payerTgToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Student_payerTgToken_key" ON "Student"("payerTgToken");

