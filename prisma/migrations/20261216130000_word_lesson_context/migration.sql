CREATE TABLE "WordLessonContext" (
    "wordId" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "example" TEXT NOT NULL,
    CONSTRAINT "WordLessonContext_pkey" PRIMARY KEY ("wordId", "meaning")
);
ALTER TABLE "WordLessonContext" ADD CONSTRAINT "WordLessonContext_wordId_fkey"
    FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
