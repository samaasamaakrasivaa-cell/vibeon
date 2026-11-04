-- DropForeignKey
ALTER TABLE "Checkpoint" DROP CONSTRAINT "Checkpoint_roadmapId_fkey";

-- AlterTable
ALTER TABLE "Checkpoint" ADD COLUMN     "answers" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "level" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'test',
ADD COLUMN     "stage" INTEGER,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'assigned',
ADD COLUMN     "studentId" TEXT NOT NULL,
ALTER COLUMN "roadmapId" DROP NOT NULL,
ALTER COLUMN "takenAt" DROP NOT NULL,
ALTER COLUMN "takenAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Roadmap" ADD COLUMN     "baseEta" TIMESTAMP(3),
ADD COLUMN     "builtAt" TIMESTAMP(3),
ADD COLUMN     "courseIds" TEXT[],
ADD COLUMN     "criteria" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "fromLevel" TEXT,
ADD COLUMN     "leadCourseId" TEXT,
ADD COLUMN     "mood" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "paceStudent" TEXT,
ADD COLUMN     "reportAt" TIMESTAMP(3),
ADD COLUMN     "startHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "units" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "Checkpoint_studentId_status_idx" ON "Checkpoint"("studentId", "status");

-- CreateIndex
CREATE INDEX "Roadmap_studentId_idx" ON "Roadmap"("studentId");

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "Roadmap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

