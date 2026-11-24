-- CreateTable
CREATE TABLE "StudySlot" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "repeat" BOOLEAN NOT NULL DEFAULT true,
    "weekday" INTEGER,
    "date" TEXT,
    "startMin" INTEGER NOT NULL,
    "durMin" INTEGER NOT NULL,
    "remind" BOOLEAN NOT NULL DEFAULT true,
    "byTeacher" BOOLEAN NOT NULL DEFAULT false,
    "from" TEXT NOT NULL,
    "until" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyLog" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudySlot_studentId_idx" ON "StudySlot"("studentId");

-- CreateIndex
CREATE INDEX "StudyLog_studentId_day_idx" ON "StudyLog"("studentId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "StudyLog_slotId_day_key" ON "StudyLog"("slotId", "day");

-- AddForeignKey
ALTER TABLE "StudySlot" ADD CONSTRAINT "StudySlot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyLog" ADD CONSTRAINT "StudyLog_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "StudySlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

