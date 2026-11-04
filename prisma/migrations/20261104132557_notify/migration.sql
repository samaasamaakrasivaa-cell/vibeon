-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupe" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notify" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "tgLinkToken" TEXT;

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Delivery_status_notBefore_idx" ON "Delivery"("status", "notBefore");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupe_key" ON "Notification"("dedupe");

-- CreateIndex
CREATE UNIQUE INDEX "User_tgLinkToken_key" ON "User"("tgLinkToken");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

