import "server-only";
import { db } from "../db";
import { addDaysIso, dayStart, hhmm, isoDay, minutesOfDay, mondayOf, parseIsoDay, partsIn } from "../time";
import { studyWeek } from "./data";

/** Неделя ученика для расписания (у ученика и во вкладке «Самостоятельно» у учителя): уроки, свои слоты, дни, диапазон часов. */
export async function weekView(studentId: string | null, tz: string, w: string | undefined, lang: "ru" | "en", t: (k: never) => string, teacher = false) {
  const s = studentId ? { id: studentId } : null;
  const todayIso = isoDay(new Date(), tz);
  const monday = mondayOf(parseIsoDay(w) ? w! : todayIso);
  const from = dayStart(monday, tz), to = dayStart(addDaysIso(monday, 7), tz);
  const rows = s ? await db.lessonInstance.findMany({ where: { studentId: s.id, startsAt: { gte: from, lt: to }, status: { not: "MISSED" } }, include: { template: true }, orderBy: { startsAt: "asc" } }) : [];
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const now = new Date();
  const lessons = rows.map((l) => {
    const end = new Date(l.startsAt.getTime() + l.durationMin * 60000);
    return {
      id: l.id, day: Math.round((dayStart(isoDay(l.startsAt, tz), tz).getTime() - from.getTime()) / 864e5), startMin: minutesOfDay(l.startsAt, tz), dur: l.durationMin,
      title: l.template?.title ?? (l.isTrial ? t("sch.trial" as never) : t("cls.lesson" as never)), status: l.status, start: hhmm(l.startsAt, tz), end: hhmm(end, tz),
      date: l.startsAt.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: tz }), moved: !!l.movedFrom, past: end <= now,
    };
  });
  // свои слоты ученика (самостоятельная работа) и слот «Слова» по настройкам слов
  const study = s ? await studyWeek(s.id, tz, monday, lang, teacher) : null;
  const hw = s ? await db.homework.findFirst({ where: { status: "ASSIGNED", lessonInstance: { studentId: s.id } }, orderBy: { lessonInstance: { startsAt: "desc" } }, select: { lessonInstanceId: true } }) : null;
  let hourFrom = 8, hourTo = 21;
  for (const l of [...lessons, ...(study?.occ ?? []).map((o) => ({ startMin: o.startMin, dur: o.dur }))]) { hourFrom = Math.min(hourFrom, Math.floor(l.startMin / 60)); hourTo = Math.max(hourTo, Math.ceil((l.startMin + l.dur) / 60)); }
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(monday, i);
    const mid = new Date(dayStart(iso, tz).getTime() + 12 * 3600e3);
    return { iso, num: parseIsoDay(iso)!.d, today: iso === todayIso, past: iso < todayIso, dow: mid.toLocaleDateString(loc, { weekday: "short", timeZone: tz }).replace(".", ""), long: mid.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: tz }) };
  });
  const p = partsIn(now, tz);
  return {
    monday, loc, days, lessons, hourFrom, hourTo, nowDay: days.findIndex((d) => d.today), nowMin: p.h * 60 + p.min,
    study: study ? { ...study, hwLink: hw ? `/class/${hw.lessonInstanceId}?tab=homework` : null, today: todayIso, ...(teacher ? { teacher: true, studentId: studentId! } : {}) } : undefined,
  };
}
