-- Статусы учеников (титулы и поощрения), пол для «Король / Королева», аватарка ученика
ALTER TABLE "Student" ADD COLUMN "gender" TEXT;
ALTER TABLE "Student" ADD COLUMN "avatar" TEXT;
ALTER TABLE "Student" ADD COLUMN "avatarSrc" TEXT;
ALTER TABLE "Student" ADD COLUMN "avatarNotice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Student" ADD COLUMN "tgPhotoChecked" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "Award" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT,
  "name" TEXT NOT NULL,
  "why" TEXT,
  "icon" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "onMain" BOOLEAN NOT NULL DEFAULT false,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "until" TIMESTAMP(3),
  "seenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Award_studentId_createdAt_idx" ON "Award"("studentId", "createdAt");
