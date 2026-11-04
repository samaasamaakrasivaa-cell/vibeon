-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "remindAt" TEXT NOT NULL DEFAULT '19:00',
ADD COLUMN     "wordDays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4]::INTEGER[],
ADD COLUMN     "wordGoal" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "WordPractice" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WordPractice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WordPractice_studentId_day_key" ON "WordPractice"("studentId", "day");

-- AddForeignKey
ALTER TABLE "WordPractice" ADD CONSTRAINT "WordPractice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
