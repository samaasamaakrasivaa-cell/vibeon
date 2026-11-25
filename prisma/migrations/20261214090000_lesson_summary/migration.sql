-- Итог урока по ученику: темы, сомнительные ответы, трудное и долгое задание
CREATE TABLE "LessonSummary" (
    "id" TEXT NOT NULL,
    "lessonInstanceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "topics" JSONB NOT NULL DEFAULT '[]',
    "checks" JSONB NOT NULL DEFAULT '[]',
    "notes" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    CONSTRAINT "LessonSummary_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LessonSummary_lessonInstanceId_studentId_key" ON "LessonSummary"("lessonInstanceId", "studentId");
CREATE INDEX "LessonSummary_studentId_idx" ON "LessonSummary"("studentId");
ALTER TABLE "LessonSummary" ADD CONSTRAINT "LessonSummary_lessonInstanceId_fkey" FOREIGN KEY ("lessonInstanceId") REFERENCES "LessonInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonSummary" ADD CONSTRAINT "LessonSummary_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
