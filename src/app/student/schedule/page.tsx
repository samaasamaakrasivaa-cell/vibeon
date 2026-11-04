import Link from "next/link";
import { Icon } from "@/components/Icon";
import { StudentWeek } from "@/components/student/StudentWeek";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { addDaysIso, dayStart, hhmm, isoDay, minutesOfDay, mondayOf, parseIsoDay, partsIn, weekRange } from "@/lib/time";

export const metadata = { title: "Расписание" };
export const dynamic = "force-dynamic";

export default async function StudentSchedule({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  const tz = me.timezone;
  const w = (await searchParams).w;
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
      title: l.template?.title ?? (l.isTrial ? t("sch.trial") : t("cls.lesson")), status: l.status, start: hhmm(l.startsAt, tz), end: hhmm(end, tz),
      date: l.startsAt.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: tz }), moved: !!l.movedFrom, past: end <= now,
    };
  });
  let hourFrom = 8, hourTo = 21;
  for (const l of lessons) { hourFrom = Math.min(hourFrom, Math.floor(l.startMin / 60)); hourTo = Math.max(hourTo, Math.ceil((l.startMin + l.dur) / 60)); }
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(monday, i);
    const mid = new Date(dayStart(iso, tz).getTime() + 12 * 3600e3);
    return { iso, num: parseIsoDay(iso)!.d, today: iso === todayIso, past: iso < todayIso, dow: mid.toLocaleDateString(loc, { weekday: "short", timeZone: tz }).replace(".", ""), long: mid.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: tz }) };
  });
  const p = partsIn(now, tz);
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>{t("nav.schedule")}</h1>
      <p className="muted mt-2">{t("sts.lead")}</p>
      <StudentWeek days={days} lessons={lessons} hourFrom={hourFrom} hourTo={hourTo} nowDay={days.findIndex((d) => d.today)} nowMin={p.h * 60 + p.min} title={t("sts.week")} nav={
        <div className="weeknav">
          <Link href={`?w=${addDaysIso(monday, -7)}`} aria-label={t("sch.prev")}><Icon name="chevl" size="sm" /></Link>
          <span>{weekRange(monday, tz, loc)}</span>
          <Link href={`?w=${addDaysIso(monday, 7)}`} aria-label={t("sch.next")}><Icon name="right" size="sm" /></Link>
        </div>
      } />
    </div>
  );
}
