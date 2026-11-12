-- Блок урока «Для учителя»: ученику не показывается
ALTER TABLE "LessonTemplate" ADD COLUMN "teacherInfo" JSONB NOT NULL DEFAULT '{}';
