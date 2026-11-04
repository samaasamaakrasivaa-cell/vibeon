import Link from "next/link";
import { Icon } from "@/components/Icon";
import { WeekGrid, type GridLesson } from "@/components/teacher/WeekGrid";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { addDaysIso, dayStart, hhmm, isoDay, minutesOfDay, mondayOf, parseIsoDay, partsIn } from "@/lib/time";
import { earnedOf, lessonInclude, lessonWho, rub, syncSchedule } from "@/lib/teacher/data";
import { initials } from "@/lib/invite";

export const metadata = { title: "Расписание" };

export default async function Schedule({ searchParams }: { searchParams: Promise<{ w?: string; new?: string; student?: string; trial?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const tz = me.timezone;
  const sp = await searchParams;
  await syncSchedule(me.id);

  const todayIso = isoDay(new Date(), tz);
  const monday = mondayOf(parseIsoDay(sp.w) ? sp.w! : todayIso);
  const from = dayStart(monday, tz);
  const to = dayStart(addDaysIso(monday, 7), tz);

  const [rows, students] = await Promise.all([
    db.lessonInstance.findMany({ where: { teacherId: me.id, startsAt: { gte: from, lt: to } }, include: lessonInclude, orderBy: { startsAt: "asc" } }),
    db.student.findMany({ where: { teacherId: me.id, status: { in: ["ACTIVE", "INVITED"] } }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
  ]);

  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const now = new Date();
  const lessons: GridLesson[] = rows.map((l) => {
    const end = new Date(l.startsAt.getTime() + l.durationMin * 60000);
    const day = Math.round((dayStart(isoDay(l.startsAt, tz), tz).getTime() - from.getTime()) / 864e5);
    return {
      id: l.id, day, startMin: minutesOfDay(l.startsAt, tz), dur: l.durationMin, status: l.status, who: lessonWho(l),
      isTrial: l.isTrial, isGroup: !!l.group, note: l.note, date: isoDay(l.startsAt, tz), start: hhmm(l.startsAt, tz), end: hhmm(end, tz),
      weekly: !!l.seriesId, past: end <= now, studentId: l.studentId, charged: l.charged, moved: !!l.movedFrom, price: l.price ?? 0,
    };
  });

  // Часы сетки: 8:00–21:00, расширяется под уроки раньше/позже
  let hourFrom = 8, hourTo = 21;
  for (const l of lessons) {
    hourFrom = Math.min(hourFrom, Math.floor(l.startMin / 60));
    hourTo = Math.max(hourTo, Math.min(24, Math.ceil((l.startMin + l.dur) / 60)));
  }

  const weekTotal = rows.reduce((s, l) => s + earnedOf(l), 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(monday, i);
    const d = dayStart(iso, tz);
    const earned = rows.filter((l) => isoDay(l.startsAt, tz) === iso).reduce((s, l) => s + earnedOf(l), 0);
    return {
      iso, num: parseIsoDay(iso)!.d, today: iso === todayIso, past: iso < todayIso, earned: earned ? rub(earned, lang) : null,
      dow: new Date(d.getTime() + 12 * 3600e3).toLocaleDateString(loc, { weekday: "short", timeZone: tz }).replace(".", ""),
    };
  });
  const nowDay = days.findIndex((d) => d.today);
  const rangeLabel = (iso: string) => new Date(dayStart(iso, tz).getTime() + 12 * 3600e3).toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: tz }).replace(".", "");

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1>{t("nav.schedule")}</h1>
        <div className="flex items-center gap-2">
          {monday !== mondayOf(todayIso) && <Link href="/teacher/schedule" className="btn secondary sm">{t("dash.today")}</Link>}
          <div className="weeknav">
            <Link href={`/teacher/schedule?w=${addDaysIso(monday, -7)}`} aria-label={t("sch.prev")}><Icon name="chevl" size="sm" /></Link>
            <span>{rangeLabel(monday)} – {rangeLabel(addDaysIso(monday, 6))}</span>
            <Link href={`/teacher/schedule?w=${addDaysIso(monday, 7)}`} aria-label={t("sch.next")}><Icon name="right" size="sm" /></Link>
          </div>
        </div>
      </div>
      <section className="card" style={{ padding: "20px 20px 18px" }}>
        <WeekGrid
          days={days}
          lessons={lessons}
          hourFrom={hourFrom}
          hourTo={hourTo}
          nowDay={nowDay}
          todayIso={todayIso}
          nowMin={partsIn(now, tz).h * 60 + partsIn(now, tz).min}
          students={students.map((s) => ({ id: s.id, name: [s.name, s.lastName].filter(Boolean).join(" "), initials: initials(s.name, s.lastName) }))}
          weekTotal={rub(weekTotal, lang)}
          legend
          preset={sp.new ? { studentId: sp.student, trial: sp.trial === "1" } : undefined}
        />
      </section>
      <p className="hint mt-3">{t("sch.hint")}</p>
    </div>
  );
}
