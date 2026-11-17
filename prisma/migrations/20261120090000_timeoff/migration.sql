-- Нерабочее время учителя в расписании; отметка, что @ник ученика из Telegram уже пробовали подтянуть
ALTER TABLE "Student" ADD COLUMN "tgChecked" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "TimeOff" (
  "id" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "weekly" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TimeOff_teacherId_startsAt_idx" ON "TimeOff"("teacherId", "startsAt");
