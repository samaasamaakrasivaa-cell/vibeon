// Импорт готового урока или курса из JSON (например, подготовленного Claude по PDF) — без ИИ-разбора на платформе.
// Формат совпадает с заданиями конструктора: type + title + content в разметке платформы (см. HOWTO).

import { HOWTO, isType, TYPES, type TaskType } from "./catalog";

export type ImpTask = { type: TaskType; title: string; content: string; section?: "lesson" | "homework" | "words"; teacherOnly?: boolean; part?: string };
export type ImpPlan = { title?: string; level?: string; units: { title: string; lessons: { title: string; tasks: ImpTask[] }[] }[] };

const s = (x: unknown, n: number) => (typeof x === "string" ? x : x == null ? "" : String(x)).slice(0, n);
function task(x: unknown): ImpTask | null {
  const o = (x ?? {}) as Record<string, unknown>;
  const type = s(o.type, 20);
  if (!isType(type) || TYPES[type].g === "tech") return null;
  const sec = o.section === "homework" || o.section === "words" ? o.section : "lesson";
  return { type, title: s(o.title, 300), content: s(o.content, 50000), section: sec, teacherOnly: o.teacherOnly === true || undefined, part: s(o.part, 80) || undefined };
}
const tasksOf = (x: unknown) => (Array.isArray(x) ? x.map(task).filter((t): t is ImpTask => !!t) : []);

/** Разбирает текст: JSON урока ({title, tasks}), нескольких уроков ({lessons}) или курса ({units}). null — это не JSON такого вида. */
export function parseImport(text: string): ImpPlan | null {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  if (!raw.startsWith("{") && !raw.startsWith("[")) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  const o = (Array.isArray(j) ? { tasks: j } : j) as Record<string, unknown>;
  const lesson = (l: unknown, i: number) => { const x = (l ?? {}) as Record<string, unknown>; return { title: s(x.title, 160) || `Lesson ${i + 1}`, tasks: tasksOf(x.tasks) }; };
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
  "tasks": [
    { "type": "text", "part": "Reading", "title": "Read the text", "content": "..." },
    { "type": "gap", "part": "Reading", "title": "Complete the sentences", "content": "..." },
    { "type": "essay", "section": "homework", "title": "Write about ...", "content": "..." }
  ]
}

Rules:
- Keep the order of the original lesson. Do not invent new exercises and do not drop any; keep the original wording and answers.
- "title" — the task instruction the student sees (in English, as in the material).
- "part" (optional) — the lesson stage the task belongs to, e.g. "Lead-in", "Vocabulary", "Reading", "Grammar", "Speaking". Tasks with the same part are grouped together.
- "section" (optional) — "lesson" (default), "homework" or "words" (vocabulary list).
- "teacherOnly": true — for teacher notes, answer keys or tips the student must not see.
- "content" — the task body in the platform markup for its type (below). Use \\n for new lines. Answers must be inside the markup, not in a separate key.
- Pictures, audio and video can't go into JSON: where the material has one, add a task { "type": "note", "teacherOnly": true, "title": "Add media", "content": "Add the picture/audio here: <short description, page number>" }.
- If several lessons: { "lessons": [ { "title": "...", "tasks": [...] }, ... ] }.
- Output only the JSON, no comments before or after it.

Task types and markup:
${types.map((k) => `- "${k}" — ${TYPES[k].en}. ${HOWTO[k]![0]}`).join("\n")}`;
}
