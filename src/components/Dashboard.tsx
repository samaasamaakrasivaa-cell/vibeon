import Link from "next/link";
import { Clock } from "./Clock";
import { Icon } from "./Icon";
import { NotificationList } from "./NotificationList";
import { getT } from "@/lib/i18n/server";
import { greetingKey, hourIn } from "@/lib/greeting";
import { db } from "@/lib/db";
import { addDaysIso, dayStart, hhmm, isoDay, mondayOf } from "@/lib/time";
import { lessonInclude, lessonWho, syncSchedule } from "@/lib/teacher/data";
import { initials } from "@/lib/invite";
import type { User } from "@prisma/client";

/** Главный экран «Обновления»: приветствие, часы, «Сегодня», неделя, «Что нового». */
export async function Dashboard({ user, role }: { user: User; role: "TEACHER" | "STUDENT" }) {
  const { t, lang } = await getT();
  const tz = user.timezone;
  const now = new Date();
  const todayIso = isoDay(now, tz);
  const from = dayStart(todayIso, tz);
  const to = dayStart(addDaysIso(todayIso, 7), tz);
  if (role === "TEACHER") await syncSchedule(user.id);

  const where = role === "TEACHER" ? { teacherId: user.id } : { student: { userId: user.id } };
  const [lessons, notifications] = await Promise.all([
    db.lessonInstance.findMany({ where: { ...where, startsAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, include: lessonInclude, orderBy: { startsAt: "asc" } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const todayLessons = lessons.filter((l) => isoDay(l.startsAt, tz) === todayIso);
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(todayIso, i);
    return { iso, n: lessons.filter((l) => isoDay(l.startsAt, tz) === iso).length, label: new Date(dayStart(iso, tz).getTime() + 12 * 3600e3).toLocaleDateString(loc, { weekday: "short", day: "numeric", timeZone: tz }).replace(".", "") };
  });
  const lessonsWord = (n: number) =>
    lang === "en" ? `${n} lesson${n === 1 ? "" : "s"}` : `${n} ${n % 10 === 1 && n % 100 !== 11 ? "урок" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "урока" : "уроков"}`;
  const ago = (d: Date) => {
    const m = Math.round((now.getTime() - d.getTime()) / 60000);
    if (m < 60) return t("nt.minAgo", { n: Math.max(1, m) });
    if (m < 24 * 60) return t("nt.hAgo", { n: Math.round(m / 60) });
    return d.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz });
  };
  const scheduleHref = role === "TEACHER" ? "/teacher/schedule" : "/student/schedule";

  return (
    <div className="page">
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-6 border-b border-sep pb-6">
          <div>
            <div className="text-[19px] text-text2">{t(greetingKey(hourIn(tz)))}</div>
            <div className="gname">{user.name}</div>
          </div>
          <Clock lang={lang} tz={tz} />
        </div>

        <h2 className="mt-6 mb-3">{t("dash.today")}</h2>
        {todayLessons.length === 0 ? (
          <p className="hint m-0">{t("dash.noLessons")}</p>
        ) : (
          <table className="today">
            <thead>
              <tr><th>{t("today.time")}</th><th>{role === "TEACHER" ? t("today.student") : t("today.lesson")}</th><th>{t("nav.homework")}</th><th>{t("today.class")}</th><th>{t("today.comment")}</th></tr>
            </thead>
            <tbody>
              {todayLessons.map((l) => {
                const start = l.startsAt.getTime(), end = start + l.durationMin * 60000;
                const live = start <= now.getTime() && now.getTime() < end;
                const inMin = Math.round((start - now.getTime()) / 60000);
                const soon = inMin > 0 && inMin <= 60;
                const who = role === "TEACHER" ? lessonWho(l) : t("dash.lesson");
                return (
                  <tr key={l.id} className={live ? "now" : soon ? "soon" : ""}>
                    <td className="whitespace-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <b className={live ? "text-ok" : ""}>{hhmm(l.startsAt, tz)}</b>
                      {soon && <div className="small font-semibold text-accent">{t("today.startsIn", { n: inMin })}</div>}
                      {live && <div className="small font-semibold text-ok">{t("today.live")}</div>}
                    </td>
                    <td>
                      <span className="flex items-center gap-3">
                        <span className="avatar">{l.group ? <Icon name="group" size="sm" /> : initials(...(who.split(" ") as [string, string]))}</span>
                        {role === "TEACHER" && l.studentId ? <Link href={`/teacher/students/${l.studentId}`} className="font-semibold hover:text-accent">{who}</Link> : <b>{who}</b>}
                        {l.isTrial && <span className="pill violet">{t("sch.trial")}</span>}
                      </span>
                    </td>
                    <td className="c-hw"><span className="pill grey" title={t("common.soon", { n: 5 })}>{t("today.noHw")}</span></td>
                    <td className="c-class"><Link href={`/class/${l.id}`} className={`btn sm ${soon || live ? "primary" : "secondary"}`}><Icon name="class" size="sm" />{role === "TEACHER" ? t("dash.openClass") : t("cls.enter")}</Link></td>
                    <td className="c-cmt">
                      {role === "TEACHER" ? (
                        <Link href={`${scheduleHref}?w=${todayIso}`} className={`cmt ${l.note ? "" : "empty"}`} title={l.note ?? t("today.addNote")}>{l.note ?? t("dash.noComment")}</Link>
                      ) : <span className={`cmt ${l.note ? "" : "empty"}`} title={l.note ?? ""}>{l.note ?? t("dash.noComment")}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <h3 className="mt-7 mb-3">{t("dash.week")}</h3>
        <div className="grid grid-cols-7 gap-1 max-[760px]:flex max-[760px]:overflow-x-auto">
          {days.map((d, i) => (
            <Link key={d.iso} href={`${scheduleHref}?w=${mondayOf(d.iso)}`} className={`daytile ${i === 0 ? "on" : ""}`}>
              <span className={`text-[12px] ${i === 0 ? "font-semibold" : "text-text3"}`}>{i === 0 ? t("dash.today") : d.label}</span>
              <span className="text-[15px] font-semibold">{lessonsWord(d.n)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card">
        <NotificationList
          items={notifications.map((n) => ({ id: n.id, title: n.title, when: ago(n.createdAt), unread: !n.readAt, done: !!n.doneAt, link: n.link, action: n.action }))}
        />
      </section>
    </div>
  );
}
