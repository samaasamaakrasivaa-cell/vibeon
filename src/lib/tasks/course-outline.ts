import { z } from "zod";

export const OUTLINE_FILE_LIMIT = 8;
export const OUTLINE_SOURCE_LIMIT = 24_000;
export const isCourseOutlineImage = (name: string) => /\.(?:jpe?g|png|webp)$/i.test(name);
const unitLimit = 40;
const lessonLimit = 40;

const field = (limit: number) => z.string().trim().default("").transform((text) => text.slice(0, limit));
const lessonSchema = z.object({
  title: z.string().trim().min(1).transform((text) => text.slice(0, 160)),
  topics: field(1_000),
  grammar: field(1_000),
  vocabulary: field(1_000),
  skills: field(1_000),
});
const unitSchema = lessonSchema.extend({
  title: z.string().trim().min(1).transform((text) => text.slice(0, 120)),
  lessons: z.array(lessonSchema).max(lessonLimit).default([]),
});
export const courseOutlineSchema = z.object({
  units: z.array(unitSchema).max(unitLimit),
});
export type CourseOutline = z.infer<typeof courseOutlineSchema>;
export type CourseOutlineEntry = z.infer<typeof lessonSchema>;

const outcomes = [
  ["topics", "Topics"],
  ["grammar", "Grammar"],
  ["vocabulary", "Vocabulary"],
  ["skills", "Skills"],
] as const;

/** Keeps each category in the first entries that Roadmap reads. */
export function outlineUnitOutcomes(unit: CourseOutline["units"][number]) {
  const groups = outcomes.map(([field, label]) => {
    const heading = `${label} — `;
    const limit = 200 - heading.length;
    const values = [...new Set([unit[field], ...unit.lessons.map((lesson) => lesson[field])].filter(Boolean))];
    let rest = values.join(" · ").replace(/\s*[,;]+\s*/g, " / ").replace(/\s+/g, " ");
    const parts: string[] = [];
    while (rest) {
      const wordEnd = rest.lastIndexOf(" ", limit);
      const end = rest.length > limit && wordEnd >= limit / 2 ? wordEnd : limit;
      parts.push(heading + rest.slice(0, end).trimEnd());
      rest = rest.slice(end).trimStart();
    }
    return parts;
  });
  return [...groups.flatMap((parts) => parts.slice(0, 1)), ...groups.flatMap((parts) => parts.slice(1))];
}
