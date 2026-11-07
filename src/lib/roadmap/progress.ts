import "server-only";
import { db } from "../db";
import { addDaysIso, dayStart, isoDay, mondayOf } from "../time";
import { parsePace, perWeek, routeState, etaDate, type Pace } from "./math";
import type { Stage } from "./cefr";

// Сколько ученик позанимался: уроки (по длительности), домашка (≈ 6 мин на задание), слова (≈ 30 с на слово).
const HW_MIN = 6, WORD_MIN = 0.5;

async function hours(studentId: string, from: Date, to: Date) {
  const [lessons, answers, practice] = await Promise.all([
    db.lessonInstance.findMany({ where: { studentId, status: "DONE", isTrial: false, startsAt: { gte: from, lt: to } }, select: { durationMin: true } }),
    db.answer.count({ where: { studentId, status: { not: "DRAFT" }, updatedAt: { gte: from, lt: to }, lessonInstance: { status: "DONE" } } }),
    db.wordPractice.findMany({ where: { studentId, day: { gte: isoDay(from, "UTC"), lt: isoDay(to, "UTC") } }, select: { count: true } }),
  ]);
  const les = lessons.reduce((a, l) => a + l.durationMin, 0) / 60;
  return { les, hw: (answers * HW_MIN) / 60, wd: (practice.reduce((a, p) => a + p.count, 0) * WORD_MIN) / 60, lessons: lessons.length };
}

/** Норма недели по темпу: уроки, домашка (⅔ самостоятельного времени), слова (⅓). */
export const norm = (p: Pace, lessonMin = 60) => ({ les: (p.lessons * lessonMin) / 60, hw: ((p.min * 7) / 60) * (2 / 3), wd: ((p.min * 7) / 60) * (1 / 3) });

export async function lessonMinOf(studentId: string) {
  const l = await db.lessonInstance.findFirst({ where: { studentId, isTrial: false }, orderBy: { startsAt: "desc" }, select: { durationMin: true } });
  return l?.durationMin ?? 60;
}

export type RoadmapView = Awaited<ReturnType<typeof roadmapView>>;

/** Всё для страниц маршрута: этапы, пройдено часов, прогноз, недели, достижения. */
export async function roadmapView(studentId: string, tz: string, weekBack = 0) {
  const r = await db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } });
  const checkpoints = await db.checkpoint.findMany({ where: { studentId }, orderBy: { assignedAt: "asc" } });
  if (!r) return { r: null, checkpoints } as const;
  const stages = (r.stages as Stage[]) ?? [];
  const lessonMin = await lessonMinOf(studentId);
  const since = r.approvedAt ?? r.createdAt;
  const all = await hours(studentId, since, new Date(Date.now() + 864e5));
  const done = r.startHours + all.les + all.hw + all.wd;
  const st = routeState(stages, done);
  const paceT = parsePace(r.pace), paceS = r.paceStudent ? parsePace(r.paceStudent) : paceT;
  // недели: понедельник–воскресенье в поясе ученика
  const today = isoDay(new Date(), tz);
  const mon = addDaysIso(mondayOf(today), -7 * (weekBack + 1));
  const wFrom = dayStart(mon, tz), wTo = dayStart(addDaysIso(mon, 7), tz);
  const week = await hours(studentId, wFrom, wTo);
  const cancelled = await db.lessonInstance.count({ where: { studentId, status: "CANCELLED", startsAt: { gte: wFrom, lt: wTo } } });
  const eta = etaDate(st.left, paceS, lessonMin);
  const lateWeeks = r.baseEta ? Math.round((eta.getTime() - r.baseEta.getTime()) / (7 * 864e5)) : 0;
  const [lessonsTotal, wordsLearned] = await Promise.all([
    db.lessonInstance.count({ where: { studentId, status: "DONE", isTrial: false } }),
    db.word.count({ where: { studentId, level: { gte: 4 } } }), // «выучено» — как на странице «Слова»
  ]);
  return {
    r, checkpoints, stages, lessonMin, done, st, paceT, paceS, eta, lateWeeks,
    week: { ...week, cancelled, from: mon, to: addDaysIso(mon, 6) }, norm: norm(paceS, lessonMin),
    achievements: { lessons: lessonsTotal, hours: Math.round(all.les + all.hw + all.wd + r.startHours), words: wordsLearned, pct: Math.round(st.frac * 100) },
    perWeek: perWeek(paceS, lessonMin),
  } as const;
}

/** Данные вкладки «Маршрут к цели» у учителя. */
export async function editorData(studentId: string, teacherId: string, tz: string, lang: "ru" | "en") {
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId } });
  const v = await roadmapView(studentId, tz);
  const courses = await db.course.findMany({ where: { teacherId }, orderBy: { order: "asc" }, include: { _count: { select: { units: true } } } });
  const T = (x: unknown) => (typeof x === "string" ? x : Array.isArray(x) ? String(lang === "en" ? x[0] : x[1]) : "");
  const r = v.r;
  const pas = await db.placementAttempt.findMany({ where: { studentId, checkpointId: { not: null } }, select: { id: true, checkpointId: true, status: true } });
  const paOf = new Map(pas.map((p) => [p.checkpointId!, p]));
  return {
    studentId, first: s.name, ini: `${s.name[0] ?? ""}${s.lastName?.[0] ?? ""}`.toUpperCase(), level: s.level,
    courses: courses.map((c) => ({ id: c.id, title: c.title, units: c._count.units })),
    checkpoints: v.checkpoints.map((c) => {
      const res = (c.results ?? {}) as { skills?: Record<string, number>; weak?: [string, string][] };
      return { id: c.id, kind: c.kind, status: c.status, source: c.source, level: c.level, skills: res.skills ?? {}, weak: res.weak ?? [], takenAt: c.takenAt?.toISOString() ?? null, assignedAt: c.assignedAt.toISOString(), stage: c.stage, placement: paOf.get(c.id)?.id ?? null, pstatus: paOf.get(c.id)?.status ?? null };
    }),
    roadmap: r && "stages" in v ? {
      id: r.id, type: r.type, goal: r.goal, fromLevel: r.fromLevel, deadline: r.deadline ? r.deadline.toISOString().slice(0, 7) : null, showDate: r.showDate,
      pace: r.pace ?? "2:20", mood: r.mood ?? "plan", note: r.note ?? "", courseIds: r.courseIds, leadCourseId: r.leadCourseId, approved: !!r.approvedAt, built: !!r.builtAt,
      summary: r.summary, stages: v.stages.map((x) => ({ lvl: x.lvl, title: T(x.title), hours: x.hours, grammar: x.grammar.map(T), vocabulary: x.vocabulary.map(T), skills: x.skills.map(T), passed: !!x.passed })),
      criteria: ((r.criteria as unknown[]) ?? []).map(T), units: ((r.units as { title: string }[]) ?? []).map((u) => u.title),
      done: v.done, ci: v.st.ci, left: v.st.left, lessonMin: v.lessonMin, lateWeeks: v.lateWeeks,
    } : null,
  };
}

/** Прогресс по месяцам: часы уроков и навыки по срезам. */
export async function progressData(studentId: string, tz: string) {
  const since = new Date(Date.now() - 183 * 864e5);
  const lessons = await db.lessonInstance.findMany({ where: { studentId, status: "DONE", isTrial: false, startsAt: { gte: since } }, select: { startsAt: true, durationMin: true } });
  const byMonth = new Map<string, number>();
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); byMonth.set(isoDay(d, tz).slice(0, 7), 0); }
  for (const l of lessons) { const k = isoDay(l.startsAt, tz).slice(0, 7); if (byMonth.has(k)) byMonth.set(k, byMonth.get(k)! + l.durationMin / 60); }
  const tests = await db.checkpoint.findMany({ where: { studentId, status: "done" }, orderBy: { takenAt: "asc" } });
  return { months: [...byMonth.entries()], tests: tests.map((c) => ({ at: c.takenAt!, level: c.level, kind: c.kind, skills: ((c.results as { skills?: Record<string, number> })?.skills ?? {}) })) };
}
