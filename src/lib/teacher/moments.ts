import "server-only";
import { db } from "../db";
import { nextBirthday } from "../birthdays";
import { addDaysIso, isoDay } from "../time";

// «События учеников» у учителя: дни рождения, вехи (уроки, время вместе), активность, свои события.
// Каждое событие можно отметить наградой — give подсказывает статус из каталога (и название).

export type Moment = {
  id: string; studentId: string; name: string; avatar: string | null;
  kind: "birthday" | "lessons" | "together" | "active" | "streak" | "event";
  day: string; // YYYY-MM-DD — когда
  days: number; // через сколько дней (отрицательное — уже было)
  n?: number; text?: string; eventId?: string;
  give?: { key: string; name?: string };
  given?: boolean; // похожая награда уже выдана в последние 30 дней
};

const LESSON_MARKS = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
const MONTH_MARKS = [1, 3, 6, 12, 24, 36, 48, 60];
/** «Месяц вместе», «Полгода вместе», «2 года вместе»… */
export function togetherName(m: number) {
  if (m === 1) return "Месяц вместе";
  if (m === 6) return "Полгода вместе";
  if (m === 12) return "Год вместе";
  if (m % 12 === 0) { const y = m / 12; return `${y} ${y < 5 ? "года" : "лет"} вместе`; }
  return `${m} ${m < 5 ? "месяца" : "месяцев"} вместе`;
}
const diff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 864e5);
const addMonthsIso = (iso: string, m: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };

/** studentId — только для одного ученика (анкета); иначе — по всем активным ученикам учителя. */
export async function momentsFor(teacherId: string, tz: string, studentId?: string): Promise<Moment[]> {
  const today = isoDay(new Date(), tz);
  const students = await db.student.findMany({
    where: { teacherId, status: "ACTIVE", ...(studentId ? { id: studentId } : {}) },
    select: { id: true, name: true, lastName: true, avatar: true, birthday: true, startedAt: true, createdAt: true, userId: true },
  });
  if (!students.length) return [];
  const ids = students.map((s) => s.id);
  const weekAgo = addDaysIso(today, -7);
  const [lessons, planned, act, practice, awards, events, allAct] = await Promise.all([
    db.lessonInstance.findMany({ where: { studentId: { in: ids }, status: "DONE" }, orderBy: { startsAt: "asc" }, select: { studentId: true, startsAt: true } }),
    db.lessonInstance.findMany({ where: { studentId: { in: ids }, status: "PLANNED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, select: { studentId: true, startsAt: true }, take: 500 }),
    db.activityDay.groupBy({ by: ["userId"], where: { userId: { in: students.map((s) => s.userId).filter(Boolean) as string[] }, day: { gt: weekAgo } }, _sum: { minutes: true } }),
    db.wordPractice.findMany({ where: { studentId: { in: ids }, day: { gte: addDaysIso(today, -10) }, count: { gt: 0 } }, select: { studentId: true, day: true } }),
    db.award.findMany({ where: { studentId: { in: ids }, createdAt: { gt: new Date(Date.now() - 30 * 864e5) } }, select: { studentId: true, key: true, name: true } }),
    db.studentEvent.findMany({ where: { teacherId, studentId: { in: ids }, doneAt: null, day: { gte: addDaysIso(today, -3), lte: addDaysIso(today, 30) } } }),
    // самый активный — среди всех учеников учителя (в анкете тоже сравниваем со всеми)
    studentId ? db.student.findMany({ where: { teacherId, status: "ACTIVE", userId: { not: null } }, select: { userId: true } }).then((all) => db.activityDay.groupBy({ by: ["userId"], where: { userId: { in: all.map((x) => x.userId!) }, day: { gt: weekAgo } }, _sum: { minutes: true } })) : null,
  ]);
  const gave = (sid: string, key: string, name?: string) => awards.some((a) => a.studentId === sid && (a.key === key || (!!name && a.name === name)));
  const out: Moment[] = [];
  const full = (s: (typeof students)[number]) => [s.name, s.lastName].filter(Boolean).join(" ");
  const base = (s: (typeof students)[number]) => ({ studentId: s.id, name: full(s), avatar: s.avatar });

  // активнее всех за неделю (если учеников хотя бы двое и время заметное)
  const actAll = (allAct ?? act).map((x) => ({ userId: x.userId, m: x._sum.minutes ?? 0 })).sort((a, b) => b.m - a.m);
  const top = actAll.length >= 2 && actAll[0].m >= 30 && actAll[0].m > actAll[1].m ? actAll[0] : null;

  for (const s of students) {
    // день рождения: ближайшие 30 дней и прошедшие 3 дня — «поздравили?»
    if (s.birthday) {
      const b = nextBirthday(s.birthday, addDaysIso(today, -3));
      const d = diff(b.iso, today);
      if (d <= 30) out.push({ id: `bd-${s.id}`, ...base(s), kind: "birthday", day: b.iso, days: d, n: b.age ?? undefined, give: { key: "birthday" }, given: gave(s.id, "birthday") });
    }
    // круглое число уроков: уже было (2 недели) или будет по расписанию (2 недели)
    const done = lessons.filter((l) => l.studentId === s.id);
    const plan = planned.filter((l) => l.studentId === s.id);
    for (const M of LESSON_MARKS) {
      let when: string | null = null;
      if (done.length >= M) { const d = isoDay(done[M - 1].startsAt, tz); if (diff(d, today) >= -14) when = d; }
      else if (plan[M - done.length - 1]) { const d = isoDay(plan[M - done.length - 1].startsAt, tz); if (diff(d, today) <= 14) when = d; }
      if (when) { const name = `${M} уроков вместе`; out.push({ id: `ls-${s.id}-${M}`, ...base(s), kind: "lessons", day: when, days: diff(when, today), n: M, give: { key: "lessons", name }, given: gave(s.id, "lessons", name) }); }
    }
    // время вместе: 1, 3, 6 месяцев, год… — от «начали заниматься»
    const start = isoDay(s.startedAt ?? s.createdAt, tz);
    for (const M of MONTH_MARKS) {
      const d = addMonthsIso(start, M), dd = diff(d, today);
      const label = togetherName(M);
      if (dd >= -7 && dd <= 14) out.push({ id: `tg-${s.id}-${M}`, ...base(s), kind: "together", day: d, days: dd, n: M, give: M === 12 ? { key: "year" } : { key: "together", name: label }, given: gave(s.id, M === 12 ? "year" : "together", label) });
    }
    // самый активный на платформе за неделю
    if (top && s.userId === top.userId) out.push({ id: `ac-${s.id}`, ...base(s), kind: "active", day: today, days: 0, n: top.m, give: { key: "active_week" }, given: gave(s.id, "active_week") });
    // слова: 7+ дней подряд (до сегодня или вчера)
    const days = new Set(practice.filter((p) => p.studentId === s.id).map((p) => p.day));
    let streak = 0, d = days.has(today) ? today : addDaysIso(today, -1);
    while (days.has(d)) { streak++; d = addDaysIso(d, -1); }
    if (streak >= 7) out.push({ id: `st-${s.id}`, ...base(s), kind: "streak", day: today, days: 0, n: streak, give: { key: "streak" }, given: gave(s.id, "streak") });
  }
  for (const e of events) {
    const s = students.find((x) => x.id === e.studentId)!;
    out.push({ id: `ev-${e.id}`, ...base(s), kind: "event", day: e.day, days: diff(e.day, today), text: e.text, eventId: e.id });
  }
  // сегодня → ближайшие → недавно прошедшие
  return out.sort((a, b) => (a.days < 0 ? 1000 - a.days : a.days) - (b.days < 0 ? 1000 - b.days : b.days));
}
