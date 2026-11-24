-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "tipsDoneAt" TIMESTAMP(3);


-- ученики, которые уже занимаются, подсказки новичка не видят
UPDATE "Student" SET "tipsDoneAt" = NOW() WHERE "createdAt" < NOW() - INTERVAL '14 days';
