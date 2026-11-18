-- CreateTable
CREATE TABLE "AwardTemplate" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "why" TEXT,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "term" TEXT NOT NULL DEFAULT 'forever',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwardTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AwardTemplate_teacherId_kind_name_key" ON "AwardTemplate"("teacherId", "kind", "name");


-- Свои статусы, уже выданные ученикам (не из каталога), — сразу в картотеку «Мои»: последний вариант каждого названия
INSERT INTO "AwardTemplate" ("id", "teacherId", "kind", "name", "why", "icon", "color", "term", "createdAt", "updatedAt")
SELECT 'awt_' || a."id", a."teacherId", a."kind", a."name", a."why", a."icon", a."color",
       CASE WHEN a."kind" = 'title' AND a."until" IS NOT NULL THEN 'month' ELSE 'forever' END, a."createdAt", CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON ("teacherId", "kind", "name") * FROM "Award" WHERE "key" IS NULL ORDER BY "teacherId", "kind", "name", "createdAt" DESC
) a
ON CONFLICT DO NOTHING;
