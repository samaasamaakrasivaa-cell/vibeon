// Метки заданий: тема из единого справочника (те же темы, что в placement test и маршруте), навык, уровень,
// тема каждого пропуска, ловушки в вариантах, целевые слова. По ним платформа собирает итоги уроков,
// досье ученика и срезы. Ставит ИИ, учитель видит и правит.
import topicsJson from "../../../content/placement/00_topics.json";

export type Topic = { topic_id: string; skill: string; level: string | null; topic_en: string; topic_ru: string };
export const TOPICS = (topicsJson as Topic[]).filter((t) => t.skill === "grammar" || t.skill === "vocabulary");
const BY_ID = new Map(TOPICS.map((t) => [t.topic_id, t]));
export const topicOf = (id?: string | null) => (id ? BY_ID.get(id) ?? null : null);
export const topicLabel = (id: string | undefined, name: string | undefined, lang: "ru" | "en" = "ru") => {
  const t = topicOf(id);
  return t ? (lang === "en" ? t.topic_en : t.topic_ru) : name ?? "";
};

export const TAG_SKILLS = ["grammar", "vocabulary", "reading", "listening", "writing", "speaking"] as const;
export type TagSkill = (typeof TAG_SKILLS)[number];
/** Формат задания — насколько ошибке можно верить: найди и исправь > перевод/перефраз > вписать > выбор. */
export const FORMAT_WEIGHT: Record<string, number> = { errors: 1.6, transform: 1.4, translate: 1.4, gap: 1.2, dictation: 1.2, letters: 1, sentence: 1.1, textorder: 1, drag: 0.9, dropdown: 0.8, test: 0.7, tf: 0.5, pairs: 0.8, columns: 0.8, crossword: 1, picture: 0.8 };

export type TaskTags = {
  topic?: string; // id из справочника
  topicName?: string; // своя тема, если в справочнике нет
  skill?: TagSkill;
  level?: string;
  items?: string[]; // тема каждого пропуска / пункта по порядку (id или название), если в задании несколько правил
  traps?: string[]; // какую типичную ошибку ловят неверные варианты, по пунктам
  words?: string[]; // целевая лексика задания
  by?: "ai" | "teacher";
  hint?: string; // формулировка с темой, которую предложил ИИ (учитель применяет одной кнопкой)
};

const s = (x: unknown, n: number) => (typeof x === "string" ? x.trim().slice(0, n) : "");
const list = (x: unknown, n: number, len: number) => (Array.isArray(x) ? x.map((v) => s(v, len)).filter(Boolean).slice(0, n) : []);

export function cleanTags(x: unknown): TaskTags | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;
  const id = s(o.topic, 60);
  const r: TaskTags = {
    ...(id && BY_ID.has(id) ? { topic: id } : {}),
    ...(s(o.topicName, 120) && !(id && BY_ID.has(id)) ? { topicName: s(o.topicName, 120) } : {}),
    ...((TAG_SKILLS as readonly string[]).includes(String(o.skill)) ? { skill: o.skill as TagSkill } : {}),
    ...(/^(A1|A2|B1|B2|C1|C2)\+?$/.test(String(o.level)) ? { level: String(o.level) } : {}),
    ...(list(o.items, 60, 80).length ? { items: list(o.items, 60, 80) } : {}),
    ...(list(o.traps, 60, 160).length ? { traps: list(o.traps, 60, 160) } : {}),
    ...(list(o.words, 80, 60).length ? { words: list(o.words, 80, 60) } : {}),
    ...(o.by === "teacher" ? { by: "teacher" as const } : o.by === "ai" ? { by: "ai" as const } : {}),
    ...(s(o.hint, 400) ? { hint: s(o.hint, 400) } : {}),
  };
  return r.topic || r.topicName || r.skill || r.words ? r : undefined;
}

/** Компактный справочник для ИИ: только нужные уровни (уровень курса ±1), id — название. */
export function catalogFor(level?: string | null) {
  const L = ["A1", "A2", "B1", "B2", "C1"];
  const i = level ? L.indexOf(level.replace(/[+-]$/, "")) : -1;
  const keep = i < 0 ? L : L.slice(Math.max(0, i - 1), i + 2);
  return TOPICS.filter((t) => !t.level || keep.includes(t.level)).map((t) => `${t.topic_id} — ${t.topic_en}`).join("\n");
}
