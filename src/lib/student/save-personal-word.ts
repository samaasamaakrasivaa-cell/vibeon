import "server-only";
import { db } from "../db";
import { withLock } from "../live/bus";
import { appendWordTranslation, wordTranslations } from "./word-translations";

const selection = { id: true, word: true, translation: true, example: true, level: true } as const;
type SavedWord = { id: string; word: string; translation: string | null; example: string | null; level: number };
export type WordConfirmation = Pick<SavedWord, "id" | "translation">;
type SaveResult =
  | { status: "added" | "existing" | "updated"; saved: SavedWord }
  | { status: "confirm"; existing: Pick<SavedWord, "id" | "word" | "translation">; value: string }
  | { status: "changed" | "empty" };

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

export async function savePersonalWord(studentId: string, input: {
  word: string;
  translation: string;
  example: string;
  sourceLessonId?: string;
  confirmation?: WordConfirmation;
}): Promise<SaveResult> {
  const word = collapse(text(input.word, 120));
  const translation = collapse(text(input.translation, 200));
  if (!word) return { status: "empty" };

  return withLock(`word:${studentId}`, async () => {
    const matches = await db.$queryRaw<SavedWord[]>`
      SELECT "id", "word", "translation", "example", "level" FROM "Word"
      WHERE "studentId" = ${studentId}
        AND lower(btrim(regexp_replace("word", '[[:space:]]+', ' ', 'g'))) = lower(${word})
      ORDER BY "createdAt", "id"
    `;
    const existing = matches[0];
    if (input.confirmation && input.confirmation.id !== existing?.id) return { status: "changed" };
    if (!existing) {
      const saved = await db.word.create({
        data: { studentId, word, translation: translation || null, example: text(input.example, 400) || null, sourceLessonId: input.sourceLessonId },
        select: selection,
      });
      return { status: "added", saved };
    }

    const normalized = translation.toLowerCase();
    const seen = matches.some((match) => wordTranslations(match.translation).some((value) => collapse(value).toLowerCase() === normalized));
    if (!translation || seen) return { status: "existing", saved: existing };
    if (!input.confirmation || input.confirmation.translation !== existing.translation) {
      return { status: "confirm", existing: { id: existing.id, word: existing.word, translation: existing.translation }, value: translation };
    }

    const next = appendWordTranslation(existing.translation, translation);
    const { count } = await db.word.updateMany({
      where: { id: existing.id, studentId, translation: existing.translation },
      data: { translation: next },
    });
    return count ? { status: "updated", saved: { ...existing, translation: next } } : { status: "changed" };
  });
}
