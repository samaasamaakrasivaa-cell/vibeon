-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "taskOrder" TEXT[];

UPDATE "Homework" SET "taskOrder" = ARRAY[]::TEXT[] WHERE "taskOrder" IS NULL;
ALTER TABLE "Homework" ALTER COLUMN "taskOrder" SET DEFAULT ARRAY[]::TEXT[];
