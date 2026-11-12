// Блок урока «Для учителя»: уровень, сведения об уроке, цели (общая, лексика, грамматика, навыки), ход урока, заметки.
// Хранится в LessonTemplate.teacherInfo; ученику не отдаётся никогда.

export type TInfo = { level?: string; info?: string; aims?: { main?: string; vocabulary?: string; grammar?: string; skills?: string }; overview?: string; notes?: string };
export const AIM_KEYS = ["main", "vocabulary", "grammar", "skills"] as const;

const s = (x: unknown, n: number) => (typeof x === "string" ? x.trim().slice(0, n) : "");
/** Чистит и обрезает поля; пустые убирает. */
export function cleanInfo(x: unknown): TInfo {
  const o = (x ?? {}) as Record<string, unknown>;
  const a = (o.aims ?? {}) as Record<string, unknown>;
  const aims = Object.fromEntries(AIM_KEYS.map((k) => [k, s(a[k], 2000)]).filter(([, v]) => v));
  const r: TInfo = { level: s(o.level, 20), info: s(o.info, 4000), overview: s(o.overview, 8000), notes: s(o.notes, 4000), ...(Object.keys(aims).length ? { aims } : {}) };
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v && (typeof v !== "object" || Object.keys(v).length))) as TInfo;
}
export const hasInfo = (x: TInfo | null | undefined) => !!x && Object.keys(x).length > 0;
