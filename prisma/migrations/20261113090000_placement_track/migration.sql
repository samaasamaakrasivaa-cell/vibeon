-- Placement test Teens: версия теста у прохождения и у ссылки
ALTER TABLE "PlacementAttempt" ADD COLUMN "track" TEXT NOT NULL DEFAULT 'adult';
ALTER TABLE "PlacementLink" ADD COLUMN "track" TEXT NOT NULL DEFAULT 'adult';
