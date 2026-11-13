// Импорт готового урока или курса из JSON (например, подготовленного Claude по PDF) — без ИИ-разбора на платформе.
// Формат совпадает с заданиями конструктора: type + title + content в разметке платформы (см. HOWTO).

import { HOWTO, isType, TYPES, type TaskType } from "./catalog";
import { cleanInfo, type TInfo } from "./teacher-info";

/** Опции из файла: Useful phrases, выделение слов, закреплённые строки (0-based). */
export type ImpOpts = { markable?: boolean; help?: { vocab?: string; grammar?: string }; fixed?: number[] };
export type ImpTask = { type: TaskType; title: string; content: string; section?: "lesson" | "homework" | "words"; teacherOnly?: boolean; part?: string; options?: ImpOpts };
/** Многострочная формулировка: до 1500 знаков, не больше одной пустой строки подряд. */
export const cleanTitle = (x: string) => x.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
const lines = (x: unknown) => (Array.isArray(x) ? x.map((v) => s(v, 300)).join("\n") : s(x, 3000)).trim();
/** Опции, пришедшие с клиента при создании книги: те же ограничения, что и в конструкторе. */
export function cleanOpts(o: ImpOpts | undefined, type: string): ImpOpts {
  if (!o || typeof o !== "object") return {};
  const h = o.help && typeof o.help === "object" ? { vocab: s(o.help.vocab, 3000).trim(), grammar: s(o.help.grammar, 3000).trim() } : null;
  return {
    ...(o.markable === true && type === "text" ? { markable: true } : {}),
    ...(h && (h.vocab || h.grammar) ? { help: { ...(h.vocab ? { vocab: h.vocab } : {}), ...(h.grammar ? { grammar: h.grammar } : {}) } } : {}),
    ...(type === "textorder" && Array.isArray(o.fixed) ? { fixed: [...new Set(o.fixed.filter((v) => Number.isInteger(v) && v >= 0 && v < 200))].sort((a, b) => a - b) } : {}),
  };
}
function opts(o: Record<string, unknown>, type: string): ImpOpts | undefined {
  const r: ImpOpts = {};
  if (o.markable === true && type === "text") r.markable = true;
  const h = (o.help ?? o.usefulPhrases ?? null) as Record<string, unknown> | null;
  if (h && typeof h === "object") { const vocab = lines(h.vocab ?? h.vocabulary), grammar = lines(h.grammar ?? h.patterns); if (vocab || grammar) r.help = { ...(vocab ? { vocab } : {}), ...(grammar ? { grammar } : {}) }; }
  // в файле строки нумеруются с 1 (первая, последняя…), на платформе — с 0; "last" — последняя строка
  if (type === "textorder" && Array.isArray(o.fixed)) {
    const n = String(o.content ?? "").split("\n").filter((l) => l.trim()).length;
    const f = [...new Set(o.fixed.map((v) => (v === "last" ? n : Number(v)) - 1).filter((v) => Number.isInteger(v) && v >= 0 && v < n))].sort((a, b) => a - b);
    if (f.length) r.fixed = f;
  }
  return Object.keys(r).length ? r : undefined;
}
/** meta урока: блок «Для учителя», длительность, подзаголовок — не задания, ученик их не видит. */
export type ImpMeta = { teacher?: TInfo; duration?: number; subtitle?: string };
/** Проблема с отдельным заданием файла: оно пропущено, остальные загружаются. */
export type ImpIssue = { lesson: string; n: number; title: string; reason: "type" | "content" | "empty" };
export type ImpPlan = { title?: string; level?: string; units: { title: string; lessons: { title: string; tasks: ImpTask[]; meta?: ImpMeta }[] }[]; issues?: ImpIssue[] };
/** Сколько заданий в каждом разделе (для сводки перед загрузкой и после). */
export const countBySection = (tasks: { section?: string }[]) => ({
  lesson: tasks.filter((x) => (x.section ?? "lesson") === "lesson").length,
  homework: tasks.filter((x) => x.section === "homework").length,
  words: tasks.filter((x) => x.section === "words").length,
});
/** Сколько слов в наборах слов (по строке на слово). */
export const wordCount = (tasks: ImpTask[]) => tasks.filter((x) => x.type === "wordset").reduce((a, x) => a + x.content.split("\n").filter((l) => l.trim()).length, 0);
/** Сколько заданий одного урока платформа принимает за раз. */
export const MAX_TASKS = 300;

const s = (x: unknown, n: number) => (typeof x === "string" ? x : x == null ? "" : String(x)).slice(0, n);
// одно плохое задание пропускается с пометкой, остальные (в том числе домашка и слова после него) загружаются
function task(x: unknown, bad?: (reason: ImpIssue["reason"]) => void): ImpTask | null {
  const o = (x ?? {}) as Record<string, unknown>;
  const type = s(o.type, 20);
  if (!isType(type) || TYPES[type].g === "tech") { bad?.("type"); return null; }
  if (o.content != null && typeof o.content !== "string") { bad?.("content"); return null; }
  if (!["image", "audio", "video", "link", "divider"].includes(type) && !String(o.content ?? "").trim() && !String(o.title ?? "").trim()) { bad?.("empty"); return null; }
  const sec = o.section === "homework" || o.section === "words" ? o.section : "lesson";
  return { type, title: cleanTitle(s(o.title, 3000)), content: s(o.content, 50000), section: sec, teacherOnly: o.teacherOnly === true || (type === "note" && o.teacherOnly !== false) || undefined, /* заметки — по умолчанию только учителю */ part: s(o.part, 80) || undefined, options: opts(o, type) };
}
const tasksOf = (x: unknown, lesson = "", issues?: ImpIssue[]) =>
  Array.isArray(x) ? x.map((t, i) => task(t, (reason) => issues?.push({ lesson, n: i + 1, title: s((t as { title?: unknown })?.title, 80), reason }))).filter((t): t is ImpTask => !!t) : [];

/** Разбирает текст: JSON урока ({title, tasks}), нескольких уроков ({lessons}) или курса ({units}). null — это не JSON такого вида. */
export function parseImport(text: string): ImpPlan | null {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  if (!raw.startsWith("{") && !raw.startsWith("[")) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  const o = (Array.isArray(j) ? { tasks: j } : j) as Record<string, unknown>;
  const issues: ImpIssue[] = [];
  const lesson = (l: unknown, i: number) => {
    const x = (l ?? {}) as Record<string, unknown>;
    const teacher = cleanInfo({ level: x.level ?? o.level, ...((x.teacher ?? {}) as object) });
    const duration = Number(x.duration ?? x.durationMin ?? 0) || undefined;
    const meta: ImpMeta = { ...(Object.keys(teacher).length ? { teacher } : {}), ...(duration ? { duration } : {}), ...(x.subtitle ? { subtitle: s(x.subtitle, 160) } : {}) };
    const title = s(x.title, 160) || `Lesson ${i + 1}`;
    return { title, tasks: tasksOf(x.tasks, title, issues), ...(Object.keys(meta).length ? { meta } : {}) };
  };
  let units: ImpPlan["units"] = [];
  if (Array.isArray(o.units)) units = o.units.map((u, i) => { const x = (u ?? {}) as Record<string, unknown>; return { title: s(x.title, 120) || `Unit ${i + 1}`, lessons: Array.isArray(x.lessons) ? x.lessons.map(lesson) : [] }; });
  else if (Array.isArray(o.lessons)) units = [{ title: s(o.unit, 120) || s(o.title, 120) || "Unit 1", lessons: o.lessons.map(lesson) }];
  else if (Array.isArray(o.tasks)) units = [{ title: s(o.unit, 120) || "Unit 1", lessons: [lesson(o, 0)] }];
  else return null;
  units = units.map((u) => ({ ...u, lessons: u.lessons.filter((l) => l.tasks.length) })).filter((u) => u.lessons.length);
  return units.length ? { title: s(o.course ?? (Array.isArray(o.units) ? o.title : ""), 120) || undefined, level: s(o.level, 40) || undefined, units, ...(issues.length ? { issues } : {}) } : null;
}

/** Инструкция для Claude (или другого ИИ): как подготовить JSON, который платформа примет без правок. */
export function importPrompt() {
  const types = (Object.keys(TYPES) as TaskType[]).filter((k) => TYPES[k].g !== "tech" && HOWTO[k] && !["image", "audio", "video", "picture"].includes(k));
  return `You are preparing an English lesson for the VibeOn teaching platform. I will give you my lesson materials (for example, a PDF). Turn them into ONE JSON object that the platform can import as is.

Format:
{
  "title": "Lesson title",
  "subtitle": "Short topic line, e.g. Vocabulary: work",
  "level": "B1",
  "duration": 60,
  "teacher": {
    "info": "Lesson info for the teacher: topic, who it is for, materials, anything technical",
    "aims": {
      "main": "The overall aim of the lesson",
      "vocabulary": "Vocabulary aim",
      "grammar": "Grammar aim",
      "skills": "Skills aim (speaking, reading, listening, writing)"
    },
    "overview": "Lesson overview: stages in order with minutes, e.g.\\n1. Lead-in (5 min) — ...\\n2. Vocabulary (10 min) — ...",
    "notes": "Any other comments for the teacher"
  },
  "tasks": [
    { "type": "speak", "part": "Lead-in", "title": "Discuss in pairs", "content": "..." },
    { "type": "text", "part": "Reading", "title": "Read the text", "content": "..." },
    { "type": "gap", "part": "Reading", "title": "Complete the sentences", "content": "..." },
    { "type": "wordset", "section": "words", "title": "New words", "content": "word — перевод — example sentence\\n..." },
    { "type": "gap", "section": "homework", "title": "Homework: complete the sentences", "content": "..." }
  ]
}

Three places, do not mix them up:
1. "teacher" — everything only for the teacher: lesson info, level, timing, aims, overview of stages, teacher comments and tips. NEVER put this into "tasks". Level → "level", length in minutes → "duration".
2. "tasks" with "section": "lesson" (or no section) — what the student does in class. "part" = the lesson stage ("Lead-in", "Vocabulary", "Reading", "Grammar", "Speaking", "Writing"…); tasks with the same part are grouped together.
3. "tasks" with "section": "homework" — EVERY homework exercise from the material must go here, each as a separate task. "tasks" with "section": "words" — the lesson's new words: ONE "wordset" task with ALL target vocabulary of the lesson (word — Russian translation — example sentence, one word per line). If the material has a vocabulary box, word list or glossary, it must be in "words". If the material has no homework, add none.

Rules:
- Keep the order of the original lesson. Do not invent new exercises and do not drop any; keep the original wording and answers.
- "title" — the task instruction the student sees (in English, as in the material). Tasks with a title get a task number; if a block has no instruction (a question card, a text, a picture), leave "title" empty — it will have no number.
- "Useful language", "support words", "phrases to help you" and similar boxes → a separate "vocab" task placed right after the task it supports (same "part"); it is shown as a coloured frame with no task number. Put the box heading (if any) into "title".
- Formatting inside "content" and "title": **bold**, *italic*, __underline__, ==highlight==, and colour {blue}text{/} (blue, red, green, purple, orange). Keep the emphasis of the original material (e.g. key words in bold, examples in italics).
- "content" — the task body in the platform markup for its type (below). Use \\n for new lines. Answers must be inside the markup, not in a separate key.
- "title" may have several lines: use \\n between lines and \\n\\n for an empty line between paragraphs (e.g. a situation, then the instruction).
- "help" — a "Useful phrases" box for a reading, writing or speaking task, hidden under a button until the student needs it: "help": { "vocab": "phrase one\\nphrase two", "grammar": "pattern one\\npattern two" } (one item per line). Use it when the material gives language support for THAT task; a box that stands on its own as a separate block on the page is still a "vocab" task.
- "markable": true on a "text" task — the student can tap words in the text to highlight them (a free tool for working with a text, no right answers). Use it when the material asks to underline or highlight words in a text.
- "fixed" on a "textorder" task — line numbers (from 1) that stay in place and are not shuffled, e.g. "fixed": [1, "last"] for a dialogue whose first and last lines are given.
- "teacherOnly": true — only for a teacher note that must stay next to a specific task (answer key, tip). General lesson information goes to "teacher", not here. Every "note" task is hidden from the student automatically; add "teacherOnly": false only if the student must see that note.
- Pictures, audio and video can't go into JSON: where the material has one, add a task { "type": "note", "teacherOnly": true, "part": "<stage>", "title": "Add media", "content": "Add the picture/audio here: <short description, page number>" }.
- If several lessons: { "lessons": [ { "title": "...", "teacher": {...}, "tasks": [...] }, ... ] }.
- Before answering, check: is there a "teacher" block? Are all homework exercises in "homework"? Are all new words in one "wordset" in "words"?
- Output only the JSON, no comments before or after it.

Task types and markup:
${types.map((k) => `- "${k}" — ${TYPES[k].en}. ${HOWTO[k]![0]}`).join("\n")}`;
}
