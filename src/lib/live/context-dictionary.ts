import "server-only";
import { db } from "../db";
import { dictionaryQuery } from "../ai/dictionary";
import type { classAccess, LiveState } from "./access";

type Access = NonNullable<Awaited<ReturnType<typeof classAccess>>>;
const compact = (text: string) => text.replace(/\s+/g, " ").trim();
const sentences = new Intl.Segmenter("en", { granularity: "sentence" });

export async function lessonDictionaryContext(access: Access, input: unknown) {
  const live = access.host.live as LiveState;
  if (access.role === "student" && live.contextTranslation === false) return null;
  if (!input || typeof input !== "object" || !("taskId" in input) || !("query" in input) || !("sentence" in input)) return null;
  if (!access.host.templateId || typeof input.taskId !== "string" || input.taskId.length > 100 ||
      typeof input.sentence !== "string" || input.sentence.length > 320) return null;
  const word = dictionaryQuery(input.query);
  const wanted = compact(input.sentence);
  if (!word || !wanted.replace(/[’‘]/g, "'").replace(/[–—]/g, "-").toLowerCase().includes(word.toLowerCase()) || live.hidden?.includes(input.taskId)) return null;

  const task = await db.task.findFirst({
    where: { id: input.taskId, templateId: access.host.templateId, section: "lesson", type: "text", hidden: false },
    select: { content: true, options: true },
  });
  if (!task || (task.options as { teacherOnly?: boolean } | null)?.teacherOnly) return null;
  // Use the public reading text, never free-form input or the teacher-only parts of an exercise.
  const plain = task.content.replace(/\*\*(.+?)\*\*|__(.+?)__|==(.+?)==/g, "$1$2$3")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1$2")
    .replace(/\{(blue|red|green|purple|orange)\}([\s\S]+?)\{\/\w*\}/g, "$2");
  for (const paragraph of plain.split(/\n\s*\n/)) {
    for (const part of sentences.segment(compact(paragraph))) {
      if (compact(part.segment) === wanted) return { word, sentence: wanted };
    }
  }
  return null;
}
