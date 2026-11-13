-- Групповые занятия: общий slotId у уроков участников, цена группы, удаление группы не удаляет уроки
ALTER TABLE "Group" ADD COLUMN "price" INTEGER;
ALTER TABLE "LessonInstance" ADD COLUMN "slotId" TEXT;
CREATE INDEX "LessonInstance_slotId_idx" ON "LessonInstance"("slotId");
ALTER TABLE "LessonInstance" DROP CONSTRAINT "LessonInstance_groupId_fkey";
ALTER TABLE "LessonInstance" ADD CONSTRAINT "LessonInstance_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
