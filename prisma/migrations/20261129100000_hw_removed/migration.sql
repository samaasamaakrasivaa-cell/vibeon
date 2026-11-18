-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "removedTaskIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
