-- Маршрут v2: анкета учителя, вывод ИИ, диалог и версии черновика
ALTER TABLE "Roadmap" ADD COLUMN "brief" JSONB;
ALTER TABLE "Roadmap" ADD COLUMN "insight" JSONB;
ALTER TABLE "Roadmap" ADD COLUMN "chat" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Roadmap" ADD COLUMN "versions" JSONB NOT NULL DEFAULT '[]';
