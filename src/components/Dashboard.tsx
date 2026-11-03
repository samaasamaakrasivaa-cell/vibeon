import { Clock } from "./Clock";
import { Icon } from "./Icon";
import { getT } from "@/lib/i18n/server";
import { greetingKey, hourIn } from "@/lib/greeting";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";

/** Главный экран «Обновления»: приветствие, часы, «Сегодня», неделя, «Что нового». */
export async function Dashboard({ user, role }: { user: User | null; role: "TEACHER" | "STUDENT" }) {
  const { t, lang } = await getT();
  const tz = user?.timezone ?? "Europe/Moscow";
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(dayStart); weekEnd.setDate(weekEnd.getDate() + 7);

  const lessonWhere =
    role === "TEACHER"
      ? { OR: [{ student: { teacherId: user?.id ?? "-" } }, { group: { teacherId: user?.id ?? "-" } }] }
      : { student: { userId: user?.id ?? "-" } };
  const [lessons, notifications] = await Promise.all([
    db.lessonInstance.findMany({
      where: { ...lessonWhere, startsAt: { gte: dayStart, lt: weekEnd }, status: { not: "CANCELLED" } },
      select: { id: true, startsAt: true, durationMin: true, note: true, student: { select: { name: true, lastName: true } }, group: { select: { title: true } } },
      orderBy: { startsAt: "asc" },
    }),
    db.notification.findMany({ where: { userId: user?.id ?? "-" }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const todayLessons = lessons.filter((l) => l.startsAt.toDateString() === now.toDateString());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(dayStart); d.setDate(d.getDate() + i);
    const n = lessons.filter((l) => l.startsAt.toDateString() === d.toDateString()).length;
    return { d, n };
  });
  const lessonsWord = (n: number) =>
    lang === "en" ? `${n} lesson${n === 1 ? "" : "s"}` : `${n} ${n % 10 === 1 && n % 100 !== 11 ? "урок" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "урока" : "уроков"}`;

  return (
    <div className="page">
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-6 border-b border-sep pb-6">
          <div>
            <div className="text-[19px] text-text2">{t(greetingKey(hourIn(tz)))}</div>
            <div className="gname">{user?.name ?? "—"}</div>
          </div>
          <Clock lang={lang} />
        </div>

        <h2 className="mt-6 mb-3">{t("dash.today")}</h2>
        {todayLessons.length === 0 ? (
          <p className="hint m-0">{t("dash.noLessons")}</p>
        ) : (
          <div className="list">
            {todayLessons.map((l) => {
              const who = role === "TEACHER" ? (l.group?.title ?? [l.student?.name, l.student?.lastName].filter(Boolean).join(" ")) : null;
              const ini = (who ?? "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
              return (
                <div key={l.id} className="row wrap-phone">
                  <div className="min-w-[64px] font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {l.startsAt.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: tz })}
                  </div>
                  {who && <span className="avatar">{ini}</span>}
                  <div className="grow">
                    <div className="t">{who ?? t("dash.lesson")}</div>
                    <div className="s">{l.note ?? t("dash.noComment")} · {l.durationMin} {t("dash.min")}</div>
                  </div>
                  <span className="btn secondary sm" aria-disabled="true" title={t("common.soon", { n: 5 })}>
                    <Icon name="class" size="sm" />{t("dash.openClass")}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <h3 className="mt-7 mb-3">{t("dash.week")}</h3>
        <div className="grid grid-cols-7 gap-1 max-[760px]:flex max-[760px]:overflow-x-auto">
          {days.map(({ d, n }, i) => (
            <div key={i} className={`flex min-w-[84px] flex-col items-center rounded-2xl px-2 py-3 ${i === 0 ? "bg-accent text-white" : ""}`}>
              <span className={`text-[12px] ${i === 0 ? "font-semibold" : "text-text3"}`}>
                {i === 0 ? t("dash.today") : d.toLocaleDateString(loc, { weekday: "short", day: "numeric" })}
              </span>
              <span className="text-[15px] font-semibold">{lessonsWord(n)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3">{t("dash.whatsNew")}</h2>
        {notifications.length === 0 ? (
          <p className="hint m-0">{t("dash.empty")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {notifications.map((n) => (
              <div key={n.id} className={`row rounded-2xl ${n.readAt ? "" : "bg-accent-bg"}`} style={{ borderBottom: 0 }}>
                <input type="checkbox" className="check" defaultChecked={!!n.doneAt} aria-label="done" disabled />
                <div className="grow">
                  <div className="t">{n.title}</div>
                  <div className="s">{n.createdAt.toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
