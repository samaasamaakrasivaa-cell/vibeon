-- AlterTable
ALTER TABLE "AwardTemplate" ADD COLUMN     "nameEn" TEXT,
ADD COLUMN     "nameRu" TEXT,
ADD COLUMN     "whyEn" TEXT,
ADD COLUMN     "whyRu" TEXT;


-- язык уже сохранённых своих статусов — по буквам: кириллица — русский, иначе английский (второй язык переведёт ИИ)
UPDATE "AwardTemplate" SET "nameRu" = "name", "whyRu" = "why" WHERE "name" ~ '[А-Яа-яЁё]';
UPDATE "AwardTemplate" SET "nameEn" = "name", "whyEn" = "why" WHERE "name" !~ '[А-Яа-яЁё]';
