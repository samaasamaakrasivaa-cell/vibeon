-- CreateTable
CREATE TABLE "AiImage" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "style" TEXT NOT NULL DEFAULT 'flat',
    "model" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiImage_word_style_idx" ON "AiImage"("word", "style");

