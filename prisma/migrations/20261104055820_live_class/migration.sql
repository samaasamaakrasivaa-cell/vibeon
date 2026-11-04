-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "extraTaskIds" TEXT[],
ADD COLUMN     "wordTraining" TEXT[];

-- AlterTable
ALTER TABLE "LessonInstance" ADD COLUMN     "board" JSONB NOT NULL DEFAULT '{"pages":[[]]}',
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "live" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "studentNote" TEXT;
