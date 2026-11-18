-- CreateTable
CREATE TABLE "StudentEvent" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentEvent_teacherId_day_idx" ON "StudentEvent"("teacherId", "day");

-- AddForeignKey
ALTER TABLE "StudentEvent" ADD CONSTRAINT "StudentEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

