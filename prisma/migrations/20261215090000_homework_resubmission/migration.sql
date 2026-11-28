ALTER TABLE "Answer"
    ADD COLUMN "homeworkRevision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "previousHomeworkAttemptId" TEXT;

CREATE TABLE "HomeworkAttempt" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomeworkAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HomeworkAttempt_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "HomeworkAttempt_answerId_sourceRevision_key" ON "HomeworkAttempt"("answerId", "sourceRevision");
