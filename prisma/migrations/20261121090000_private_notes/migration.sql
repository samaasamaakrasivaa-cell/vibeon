-- Личные заметки учителя по категориям (интересы, поведение на уроке, что работает, ошибки…)
ALTER TABLE "Student" ADD COLUMN "privateNotes" JSONB NOT NULL DEFAULT '{}';
