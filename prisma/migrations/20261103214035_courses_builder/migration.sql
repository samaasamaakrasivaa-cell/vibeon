-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "color" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LessonTemplate" ADD COLUMN     "durationMin" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "outcomes" TEXT[],
ADD COLUMN     "shareOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subtitle" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "courseId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "rubricId" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "collapsed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Upload_path_key" ON "Upload"("path");

-- CreateIndex
CREATE INDEX "Upload_ownerId_idx" ON "Upload"("ownerId");
