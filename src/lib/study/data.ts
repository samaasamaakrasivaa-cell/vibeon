import "server-only";
import { db } from "../db";
import { addDaysIso, isoDay, minutesOfDay } from "../time";
import { parsePace } from "../roadmap/math";
import { txt, type Stage } from "../roadmap/cefr";
import { publishedSelfStudy, sharesSelfStudy } from "../roadmap/self-study";
import { KIND, isKind, wordsMin, type StudyKind } from "./kinds";

export type Occ = {
  key: string; slotId: string | null; kind: StudyKind; title: string | null; day: number; iso: string; startMin: number; dur: number;
  status: "done" | "open" | "unmarked"; auto: boolean; byTeacher: boolean; repeat: boolean; remind: boolean;
};

/** Повторяющийся слот приходится на этот день? */
export const onDay = (s: { repeat: boolean; weekday: number | null; date: string | null; from: string; until: string | null }, iso: string, dow: number) =>
  s.repeat ? s.weekday === dow && iso >= s.from && (!s.until || iso < s.until) : s.date === iso;

/** Неделя ученика: свои слоты (с отметками), слот «Слова» из настроек слов; итоги и рекомендации по маршруту. */
export async function studyWeek(studentId: string, tz: string, monday: string, lang: "ru" | "en" = "ru", teacher = false) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  const today = isoDay(new Date(), tz);
  const nowMin = minutesOfDay(new Date(), tz);
  const [s, slots, logs, practice, roadmap] = await Promise.all([
    db.student.findUnique({ where: { id: studentId }, select: { userId: true, wordDays: true, wordGoal: true, remindAt: true } }),
    db.studySlot.findMany({ where: { studentId, OR: [{ repeat: true, from: { lte: days[6] }, OR: [{ until: null }, { until: { gt: days[0] } }] }, { repeat: false, date: { gte: days[0], lte: days[6] } }] }, orderBy: { startMin: "asc" } }),
    db.studyLog.findMany({ where: { studentId, day: { gte: days[0], lte: days[6] } } }),
    db.wordPractice.findMany({ where: { studentId, day: { gte: days[0], lte: days[6] } }, select: { day: true, count: true } }),
    db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } }),
  ]);
  const activity = s?.userId ? await db.activityDay.findMany({ where: { userId: s.userId, day: { gte: days[0], lte: days[6] } } }) : [];
  const logOf = new Map(logs.map((l) => [`${l.slotId}:${l.day}`, l]));
  const hwMin = new Map(activity.map((a) => [a.day, Math.max(0, a.classMinutes - a.lessonMinutes)]));
  const wordsDone = new Map(practice.map((p) => [p.day, p.count]));
  const past = (iso: string, end: number) => iso < today || (iso === today && end <= nowMin);
  const occ: Occ[] = [];
  days.forEach((iso, di) => {
    for (const sl of slots) {
      if (!isKind(sl.kind) || !onDay(sl, iso, di)) continue;
      const log = logOf.get(`${sl.id}:${iso}`);
      if (log && (log.status === "moved" || log.status === "removed")) continue;
      // домашка засчитывается сама: в этот день была работа над домашкой (не меньше 10 минут или половины слота)
      const autoHw = sl.kind === "homework" && (hwMin.get(iso) ?? 0) >= Math.min(10, sl.durMin / 2);
      const done = log?.status === "done" || autoHw;
      occ.push({ key: `${sl.id}:${iso}`, slotId: sl.id, kind: sl.kind, title: sl.title, day: di, iso, startMin: sl.startMin, dur: sl.durMin, status: done ? "done" : past(iso, sl.startMin + sl.durMin) ? "unmarked" : "open", auto: autoHw && log?.status !== "done", byTeacher: sl.byTeacher, repeat: sl.repeat, remind: sl.remind });
    }
    // «Слова» — по настройкам слов ученика: дни, время напоминания, цель дня
    if (s && s.wordDays.includes(di)) {
      const [h, m] = s.remindAt.split(":").map(Number);
      const start = (h || 0) * 60 + (m || 0), dur = wordsMin(s.wordGoal);
      const done = (wordsDone.get(iso) ?? 0) >= s.wordGoal;
      occ.push({ key: `words:${iso}`, slotId: null, kind: "words", title: null, day: di, iso, startMin: start, dur, status: done ? "done" : past(iso, start + dur) ? "unmarked" : "open", auto: done, byTeacher: false, repeat: true, remind: true });
    }
  });
  // итоги недели и норма по маршруту (самостоятельно: минут в день × 7)
  const planned = occ.reduce((a, o) => a + o.dur, 0);
  const done = occ.filter((o) => o.status === "done").reduce((a, o) => a + o.dur, 0);
  const selfPlan = teacher ? null : publishedSelfStudy(roadmap);
  const pace = roadmap && (teacher || sharesSelfStudy(roadmap)) ? parsePace(roadmap.paceStudent ?? roadmap.pace) : null;
  const target = teacher && pace ? pace.min * 7 : selfPlan?.minutes_per_week ?? null;
  const recommendation = selfPlan ? {
    minutes: selfPlan.minutes_per_week,
    items: selfPlan.items.map(({ skill, activity, minutes, times_per_week }) => ({ skill, activity, minutes, times: times_per_week })),
  } : null;
  // рекомендации из текущего этапа маршрута: навыки и грамматика этапа → какие слоты добавить
  const recs: { kind: StudyKind; title: string | null; why: string }[] = [];
  if (roadmap && teacher) {
    const stages = (roadmap.stages as Stage[]) ?? [];
    if (stages.length) {
      // текущий этап — первый, у которого не сдан контрольный срез
      const ci = stages.findIndex((x) => !x.passed);
      const st = stages[ci < 0 ? stages.length - 1 : ci];
      const skills = (st.skills ?? []).map((x) => txt(x, lang));
      const has = (re: RegExp) => skills.find((x) => re.test(x));
      const kinds = new Set(occ.map((o) => o.kind));
      const lis = has(/listen|аудир|на слух|понима/i), rd = has(/read|чита/i), sp = has(/speak|говор|расска|обсужд/i);
      if (lis && !kinds.has("film") && !kinds.has("podcast")) recs.push({ kind: "film", title: null, why: lis });
      if (rd && !kinds.has("reading")) recs.push({ kind: "reading", title: null, why: rd });
      if (sp && !kinds.has("speaking") && !kinds.has("club")) recs.push({ kind: "speaking", title: null, why: sp });
      const g = (st.grammar ?? []).map((x) => txt(x, lang))[0];
      if (g && !kinds.has("grammar")) recs.push({ kind: "grammar", title: g.slice(0, 60), why: g });
    }
  }
  return { occ, planned, done, target, pace, recommendation, recs: recs.slice(0, 3), words: s ? { days: s.wordDays, at: s.remindAt, goal: s.wordGoal } : null, colors: Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, v.color])) };
}

export type StudyWeek = Awaited<ReturnType<typeof studyWeek>>;

/** Для маршрута: минуты самостоятельной работы (фильм, чтение, говорение…), отмеченной «сделал», — не больше 90 в день. */
export async function selfStudyMinutes(studentId: string, fromIso: string, toIso: string, client: Pick<typeof db, "studyLog"> = db) {
  const logs = await client.studyLog.findMany({ where: { studentId, status: "done", day: { gte: fromIso, lt: toIso } }, select: { day: true, minutes: true, slot: { select: { kind: true } } } });
  const per = new Map<string, number>();
  for (const l of logs) if (isKind(l.slot.kind) && KIND[l.slot.kind].self) per.set(l.day, (per.get(l.day) ?? 0) + l.minutes);
  return [...per.values()].reduce((a, m) => a + Math.min(90, m), 0);
}
