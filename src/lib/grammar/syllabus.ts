// Справочник грамматики по уровням (content/grammar/syllabus.json): Core Inventory, A2 Key, B1 Preliminary, программы
// учебников. По нему маршрут получает базовые темы участков «новый уровень»: всё, что между точкой A и целью.
import sylJson from "../../../content/grammar/syllabus.json";

export type SylTopic = { id: string; level: string; en: string; ru: string; core: boolean; group: string; sources: string[]; note?: string; aliases?: string[]; order: number };
const SYL = sylJson as unknown as { levels: string[]; groups: Record<string, string>; topics: SylTopic[] };
export const SYL_TOPICS = SYL.topics;
export const SYL_GROUPS = SYL.groups;

// шкала маршрута: A1 … C1, C1+, C2. Темы C2-ядра — участок до C1+, остальные темы C2 — до C2
const ROUTE = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1", "C1+", "C2"];
export const topicStep = (t: SylTopic) => (t.level === "C2" ? (t.core ? 9 : 10) : ROUTE.indexOf(t.level));
export const routeStep = (l: string) => ROUTE.indexOf(l.trim().match(/[ABC][12]\+?/)?.[0] ?? "");

/** Темы между уровнями: строго выше from и не выше to (по порядку программы). */
export function topicsBetween(from: string, to: string, o: { coreOnly?: boolean } = {}) {
  const a = routeStep(from), b = routeStep(to);
  if (a < 0 || b < 0 || b <= a) return [];
  return SYL_TOPICS.filter((t) => { const s = topicStep(t); return s > a && s <= b && (!o.coreOnly || t.core); }).sort((x, y) => topicStep(x) - topicStep(y) || x.order - y.order);
}
const BY_ID = new Map(SYL_TOPICS.flatMap((t) => [[t.id, t] as const, ...(t.aliases ?? []).map((a) => [a, t] as const)]));
export const sylTopic = (id?: string | null) => (id ? BY_ID.get(id) ?? null : null);
