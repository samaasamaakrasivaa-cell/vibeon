-- AlterTable
ALTER TABLE "LessonInstance" ADD COLUMN     "charged" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "movedFrom" TIMESTAMP(3),
ADD COLUMN     "price" INTEGER,
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "teacherId" TEXT,
ADD COLUMN     "trialName" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "birthday" TIMESTAMP(3),
ADD COLUMN     "callLink" TEXT,
ADD COLUMN     "course" TEXT,
ADD COLUMN     "examGoal" TEXT,
ADD COLUMN     "interests" TEXT,
ADD COLUMN     "level" TEXT,
ADD COLUMN     "packPrices" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "privateNote" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow';

-- CreateIndex
CREATE INDEX "LessonInstance_teacherId_startsAt_idx" ON "LessonInstance"("teacherId", "startsAt");

-- CreateIndex
CREATE INDEX "LessonInstance_seriesId_idx" ON "LessonInstance"("seriesId");
