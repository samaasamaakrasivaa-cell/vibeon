// Расчёты маршрута: где ученик сейчас, сколько осталось, прогноз по темпу. Без сервера — работает и в браузере.

export type Pace = { lessons: number; min: number };
export const PACES: Pace[] = [{ lessons: 1, min: 20 }, { lessons: 1, min: 30 }, { lessons: 2, min: 20 }, { lessons: 2, min: 30 }, { lessons: 3, min: 30 }, { lessons: 3, min: 45 }];
export const paceKey = (p: Pace) => `${p.lessons}:${p.min}`;
/**
 * Сколько заниматься самостоятельно. Ориентир — нормы Cambridge / CEFR: около 180–200 учебных часов на уровень
 * и 4–5 часов в неделю всего для устойчивого прогресса. Чем меньше уроков, тем больше самостоятельной работы:
 * 1 урок → всего ~4 ч в неделю, 2 → ~4,5 ч, 3 → ~5 ч, 4+ → уроки + 1 ч. Если есть срок — не меньше, чем нужно к сроку.
 */
export function selfBudget(lessons: number, lessonMin: number, totalHours?: number | null, weeksLeft?: number | null) {
  const lessonH = (Math.max(0, lessons) * lessonMin) / 60;
  const base = lessons <= 1 ? 4 : lessons === 2 ? 4.5 : lessons === 3 ? 5 : lessonH + 1;
  let week = Math.max(base, lessonH + 1);
  if (weeksLeft && weeksLeft > 0 && totalHours) week = Math.max(week, totalHours / weeksLeft);
  const selfH = Math.max(1, Math.round((week - lessonH) * 4) / 4);
  return { lessonH, selfH, weekH: lessonH + selfH, minPerWeek: Math.round(selfH * 60), minPerDay: Math.round((selfH * 60) / 7) };
}

export function parsePace(s?: string | null): Pace {
  const [a, b] = (s ?? "").split(":").map(Number);
  return a > 0 && b >= 0 ? { lessons: a, min: b } : { lessons: 2, min: 20 };
}
/** Учебных часов в неделю: уроки (по lessonMin) + самостоятельно. */
export const perWeek = (p: Pace, lessonMin = 60) => p.lessons * (lessonMin / 60) + (p.min * 7) / 60;

export type RStage = { hours: number; passed?: { score: number; at: string } | null };
export function routeState(stages: RStage[], done: number) {
  const total = stages.reduce((a, s) => a + s.hours, 0) || 1;
  let cum = 0;
  const ends = stages.map((s) => (cum += s.hours));
  let ci = ends.findIndex((e) => done < e);
  if (ci < 0) ci = Math.max(0, stages.length - 1);
  // этап, до которого дошли, но контрольный срез ещё не сдан — дальше продвижение «на паузе»
  const blocked = stages.findIndex((s, i) => !s.passed && done >= ends[i]);
  const frac = Math.min(1, done / total);
  return { total, ends, ci, blocked, frac, left: Math.max(0, total - done) };
}

export function stageMath(stages: RStage[], done: number, i: number, p: Pace, lessonMin = 60) {
  const s = stages[i];
  const end = stages.slice(0, i + 1).reduce((a, x) => a + x.hours, 0), start = end - s.hours;
  const inS = Math.max(0, Math.min(s.hours, done - start));
  const rest = s.hours - inS;
  const weeks = rest / perWeek(p, lessonMin);
  return { inS, rest, weeks, lessons: Math.round(weeks * p.lessons), self: (weeks * p.min * 7) / 60, leftAll: Math.max(0, end - done) };
}

export const weeksFor = (hours: number, p: Pace, lessonMin = 60) => hours / perWeek(p, lessonMin);
export function etaDate(hours: number, p: Pace, lessonMin = 60, from = new Date()) {
  return new Date(from.getTime() + weeksFor(hours, p, lessonMin) * 7 * 864e5);
}

const MONTHS: Record<"ru" | "en", string[]> = {
  ru: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
/** «мар–апр 2027»: разброс от −10% до +15% — прогноз, а не обещание. */
export function etaRange(hours: number, p: Pace, lang: "ru" | "en", lessonMin = 60, from = new Date()) {
  if (hours <= 0) return lang === "ru" ? "уже сейчас" : "now";
  const w = weeksFor(hours, p, lessonMin);
  const a = new Date(from.getTime() + w * 0.9 * 7 * 864e5), b = new Date(from.getTime() + w * 1.15 * 7 * 864e5);
  const M = MONTHS[lang];
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${M[a.getMonth()]} ${a.getFullYear()}`;
  return `${M[a.getMonth()]}${a.getFullYear() !== b.getFullYear() ? ` ${a.getFullYear()}` : ""}–${M[b.getMonth()]} ${b.getFullYear()}`;
}

export function fmtHM(h: number, lang: "ru" | "en") {
  const H = Math.floor(h), M = Math.round((h - H) * 60);
  if (lang === "ru") return H ? `${H} ч${M ? ` ${M} мин` : ""}` : `${M} мин`;
  return H ? `${H} h${M ? ` ${M} min` : ""}` : `${M} min`;
}

const plRu = (n: number, a: string, b: string, c: string) => { n = Math.abs(Math.round(n)); return n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c; };
export const lessonsWord = (n: number, lang: "ru" | "en") => (lang === "ru" ? `${n} ${plRu(n, "занятие", "занятия", "занятий")}` : `${n} ${n === 1 ? "lesson" : "lessons"}`);
export const paceLabel = (p: Pace, lang: "ru" | "en") => (lang === "ru" ? `${p.lessons} ${plRu(p.lessons, "урок", "урока", "уроков")} в неделю + ${p.min} мин в день` : `${p.lessons} ${p.lessons === 1 ? "lesson" : "lessons"} a week + ${p.min} min a day`);
