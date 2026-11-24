-- AlterTable
ALTER TABLE "Roadmap" ADD COLUMN     "aiDraft" JSONB;

-- CreateTable
CREATE TABLE "AiReview" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT,
    "lessonInstanceId" TEXT,
    "taskId" TEXT,
    "taskType" TEXT NOT NULL,
    "exam" TEXT NOT NULL DEFAULT 'none',
    "input" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "final" JSONB,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "compareGroup" TEXT,
    "chosen" BOOLEAN NOT NULL DEFAULT true,
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "AiReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiReview_teacherId_createdAt_idx" ON "AiReview"("teacherId", "createdAt");

-- CreateIndex
CREATE INDEX "AiReview_lessonInstanceId_taskId_studentId_idx" ON "AiReview"("lessonInstanceId", "taskId", "studentId");

-- AddForeignKey
ALTER TABLE "AiReview" ADD CONSTRAINT "AiReview_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

