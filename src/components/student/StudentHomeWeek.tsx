import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/components/icon-paths";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { studyWeek } from "@/lib/study/data";
import { KIND } from "@/lib/study/kinds";
import { addDaysIso, dayStart, hhmm, isoDay, minutesOfDay, mondayOf } from "@/lib/time";

type WeekEvent = {
  key: string;
  title: string;
  icon: IconName;
  startMin: number;
  time: string;
  dateTime: string;
  href: string;
  action: string;
};

export async function StudentHomeWeek({ studentId, tz, now, day, hasWordGoal }: {
  studentId: string;
  tz: string;
  now: Date;
  day?: string;
  hasWordGoal: boolean;
}) {
  const { t, lang } = await getT();
  const today = isoDay(now, tz);
  const days = Array.from({ length: 7 }, (_, index) => addDaysIso(today, index));
  const events = new Map(days.map((date) => [date, [] as WeekEvent[]]));
  const selected = day && events.has(day) ? day : today;
  const mondays = new Set(days.map(mondayOf));
  const [lessons, weeks] = await Promise.all([
    db.lessonInstance.findMany({
      where: {
        studentId,
        startsAt: { gte: dayStart(today, tz), lt: dayStart(addDaysIso(today, 7), tz) },
        status: { in: ["PLANNED", "DONE"] },
      },
      select: { id: true, startsAt: true, isTrial: true, template: { select: { title: true } } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    }),
    Promise.all([...mondays].map((monday) => studyWeek(studentId, tz, monday, lang))),
  ]);

  for (const lesson of lessons) {
    events.get(isoDay(lesson.startsAt, tz))?.push({
      key: `lesson:${lesson.id}`,
      title: lesson.template?.title ?? t(lesson.isTrial ? "sch.trial" : "st.weekTeacherLesson"),
      icon: "class",
      startMin: minutesOfDay(lesson.startsAt, tz),
      time: hhmm(lesson.startsAt, tz),
      dateTime: lesson.startsAt.toISOString(),
      href: `/class/${lesson.id}`,
      action: t("dash.openClass"),
    });
  }
  for (const { occ } of weeks) {
    for (const slot of occ) {
      const words = slot.kind === "words";
      if (words && slot.slotId === null && (!hasWordGoal || slot.iso === today)) continue;
      const time = `${String(Math.floor(slot.startMin / 60)).padStart(2, "0")}:${String(slot.startMin % 60).padStart(2, "0")}`;
      events.get(slot.iso)?.push({
        key: slot.key,
        title: slot.title ?? t(`st.k.${slot.kind}`),
        icon: KIND[slot.kind].icon,
        startMin: slot.startMin,
        time,
        dateTime: `${slot.iso}T${time}`,
        href: words ? "/student/words" : `/student/schedule?w=${mondayOf(slot.iso)}`,
        action: t(words ? "nav.words" : "nav.schedule"),
      });
    }
  }

  const selectedEvents = (events.get(selected) ?? []).sort((a, b) => a.startMin - b.startMin);
  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const plural = new Intl.PluralRules(locale);
  const eventCount = (n: number) => {
    const form = plural.select(n);
    return t(form === "one" ? "st.weekEventsOne" : form === "few" ? "st.weekEventsFew" : "st.weekEvents", { n });
  };
  const shortDate = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });
  const longDate = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const calendarDate = (date: string) => new Date(`${date}T12:00:00Z`);

  return (
    <section id="student-week" className="mt-6 min-w-0" aria-labelledby="student-week-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="student-week-title" className="m-0">{t("dash.week")}</h3>
        <Link href={`/student/schedule?w=${mondayOf(selected)}`} className="alink small whitespace-nowrap">{t("nav.schedule")} →</Link>
      </div>
      <nav aria-labelledby="student-week-title" className="grid grid-cols-[repeat(7,minmax(84px,1fr))] gap-1 overflow-x-auto rounded-xl p-1">
        {days.map((date) => (
          <Link key={date} href={`?d=${date}#student-week`} scroll={false} aria-current={date === selected ? "date" : undefined}
            className={`daytile ${date === selected ? "on" : ""}`}>
            <time dateTime={date} className="small" title={longDate.format(calendarDate(date))}>
              {date === today ? t("dash.today") : shortDate.format(calendarDate(date))}
            </time>
            <span className="small font-semibold whitespace-nowrap">{eventCount(events.get(date)?.length ?? 0)}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-4">
        <h4 className="mb-2 mt-0 capitalize">{selected === today ? t("dash.today") : longDate.format(calendarDate(selected))}</h4>
        {selectedEvents.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {selectedEvents.map((event) => (
              <li key={event.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface2 px-3 py-2">
                <time dateTime={event.dateTime} className="font-semibold tabular-nums">{event.time}</time>
                <Icon name={event.icon} size="sm" />
                <span className="min-w-0 flex-1 break-words">{event.title}</span>
                <Link href={event.href} prefetch={false} className="btn secondary sm">{event.action}</Link>
              </li>
            ))}
          </ul>
        ) : <p className="small muted m-0">{t("st.weekNoEvents")}</p>}
      </div>
    </section>
  );
}
