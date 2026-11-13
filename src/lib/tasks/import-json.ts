// Импорт готового урока или курса из JSON (например, подготовленного Claude по PDF) — без ИИ-разбора на платформе.
// Формат совпадает с заданиями конструктора: type + title + content в разметке платформы (см. HOWTO).

import { HOWTO, isType, TYPES, type TaskType } from "./catalog";
import { cleanInfo, type TInfo } from "./teacher-info";

export type ImpTask = { type: TaskType; title: string; content: string; section?: "lesson" | "homework" | "words"; teacherOnly?: boolean; part?: string };
/** meta урока: блок «Для учителя», длительность, подзаголовок — не задания, ученик их не видит. */
export type ImpMeta = { teacher?: TInfo; duration?: number; subtitle?: string };
export type ImpPlan = { title?: string; level?: string; units: { title: string; lessons: { title: string; tasks: ImpTask[]; meta?: ImpMeta }[] }[] };

const s = (x: unknown, n: number) => (typeof x === "string" ? x : x == null ? "" : String(x)).slice(0, n);
function task(x: unknown): ImpTask | null {
  const o = (x ?? {}) as Record<string, unknown>;
  const type = s(o.type, 20);
  if (!isType(type) || TYPES[type].g === "tech") return null;
  const sec = o.section === "homework" || o.section === "words" ? o.section : "lesson";
  return { type, title: s(o.title, 300), content: s(o.content, 50000), section: sec, teacherOnly: o.teacherOnly === true || (type === "note" && o.teacherOnly !== false) || undefined, /* заметки — по умолчанию только учителю */ part: s(o.part, 80) || undefined };
}
const tasksOf = (x: unknown) => (Array.isArray(x) ? x.map(task).filter((t): t is ImpTask => !!t) : []);

/** Разбирает текст: JSON урока ({title, tasks}), нескольких уроков ({lessons}) или курса ({units}). null — это не JSON такого вида. */
export function parseImport(text: string): ImpPlan | null {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  if (!raw.startsWith("{") && !raw.startsWith("[")) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  const o = (Array.isArray(j) ? { tasks: j } : j) as Record<string, unknown>;
  const lesson = (l: unknown, i: number) => {
    const x = (l ?? {}) as Record<string, unknown>;
    const teacher = cleanInfo({ level: x.level ?? o.level, ...((x.teacher ?? {}) as object) });
    const duration = Number(x.duration ?? x.durationMin ?? 0) || undefined;
    const meta: ImpMeta = { ...(Object.keys(teacher).length ? { teacher } : {}), ...(duration ? { duration } : {}), ...(x.subtitle ? { subtitle: s(x.subtitle, 160) } : {}) };
    return { title: s(x.title, 160) || `Lesson ${i + 1}`, tasks: tasksOf(x.tasks), ...(Object.keys(meta).length ? { meta } : {}) };
  };
  let units: ImpPlan["units"] = [];
  if (Array.isArray(o.units)) units = o.units.map((u, i) => { const x = (u ?? {}) as Record<string, unknown>; return { title: s(x.title, 120) || `Unit ${i + 1}`, lessons: Array.isArray(x.lessons) ? x.lessons.map(lesson) : [] }; });
  else if (Array.isArray(o.lessons)) units = [{ title: s(o.unit, 120) || s(o.title, 120) || "Unit 1", lessons: o.lessons.map(lesson) }];
  else if (Array.isArray(o.tasks)) units = [{ title: s(o.unit, 120) || "Unit 1", lessons: [lesson(o, 0)] }];
  else return null;
  units = units.map((u) => ({ ...u, lessons: u.lessons.filter((l) => l.tasks.length) })).filter((u) => u.lessons.length);
  return units.length ? { title: s(o.course ?? (Array.isArray(o.units) ? o.title : ""), 120) || undefined, level: s(o.level, 40) || undefined, units } : null;
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
- "teacherOnly": true — only for a teacher note that must stay next to a specific task (answer key, tip). General lesson information goes to "teacher", not here. Every "note" task is hidden from the student automatically; add "teacherOnly": false only if the student must see that note.
- Pictures, audio and video can't go into JSON: where the material has one, add a task { "type": "note", "teacherOnly": true, "part": "<stage>", "title": "Add media", "content": "Add the picture/audio here: <short description, page number>" }.
- If several lessons: { "lessons": [ { "title": "...", "teacher": {...}, "tasks": [...] }, ... ] }.
- Before answering, check: is there a "teacher" block? Are all homework exercises in "homework"? Are all new words in one "wordset" in "words"?
- Output only the JSON, no comments before or after it.

Task types and markup:
${types.map((k) => `- "${k}" — ${TYPES[k].en}. ${HOWTO[k]![0]}`).join("\n")}`;
}
