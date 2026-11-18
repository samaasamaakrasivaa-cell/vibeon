-- Домашка: задания раздела «Домашка» — заготовки, ученик видит только заданное учителем.
-- Уже существующие домашки остаются как были (раздел «Домашка» виден целиком).
ALTER TABLE "Homework" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Homework" SET "manual" = false;
