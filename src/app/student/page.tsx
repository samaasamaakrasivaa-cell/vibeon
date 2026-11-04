import Link from "next/link";
import { Clock } from "@/components/Clock";
import { Icon } from "@/components/Icon";
import { NotificationList } from "@/components/NotificationList";
import { NoteChecklist } from "@/components/student/NoteChecklist";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { greetingKey, hourIn } from "@/lib/greeting";
import { homeworkFor } from "@/lib/homework";
import { hhmm, isoDay } from "@/lib/time";

export const dynamic = "force-dynamic";

/** «Обновления» ученика: следующий урок, домашка, заметки, слова на сегодня, лента событий. */
export default async function StudentHome() {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  const tz = me.timezone;
  const now = new Date();
  const [next, last, hws, practice, dueWords, notifications] = await Promise.all([
    s ? db.lessonInstance.findFirst({ where: { studentId: s.id, status: "PLANNED", startsAt: { gt: new Date(now.getTime() - 90 * 60000) } }, orderBy: { startsAt: "asc" }, include: { template: true } }) : null,
    s ? db.lessonInstance.findFirst({ where: { studentId: s.id, status: "DONE" }, orderBy: { startsAt: "desc" }, include: { template: true } }) : null,
    s ? homeworkFor({ studentId: s.id }) : [],
    s ? db.wordPractice.findUnique({ where: { studentId_day: { studentId: s.id, day: isoDay(now, tz) } } }) : null,
    s ? db.word.count({ where: { studentId: s.id, level: { lt: 4 }, OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }] } }) : 0,
    db.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const hw = hws.find((h) => h.done < h.total);
  const goal = s?.wordGoal ?? 15;
  const done = Math.min(goal, practice?.count ?? 0);
  const inMin = next ? Math.round((next.startsAt.getTime() - now.getTime()) / 60000) : null;
  const isToday = next && isoDay(next.startsAt, tz) === isoDay(now, tz);
  const whenLabel = next ? `${isToday ? t("dash.today") : next.startsAt.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: tz })}, ${hhmm(next.startsAt, tz)}` : "";
  const allDone = !hw && done >= goal;
  const ago = (d: Date) => { const m = Math.round((now.getTime() - d.getTime()) / 60000); return m < 60 ? t("nt.minAgo", { n: Math.max(1, m) }) : m < 1440 ? t("nt.hAgo", { n: Math.round(m / 60) }) : d.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz }); };

  return (
    <div className="page">
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-6 border-b border-sep pb-6">
          <div>
            <div className="text-[19px] text-text2">{t(greetingKey(hourIn(tz)))}</div>
            <div className="gname">{me.name}</div>
          </div>
          <Clock lang={lang} tz={tz} />
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {next ? (
            <div className="nextcard">
              <div className="small opacity-90">{t("st.next")}</div>
              <div className="mt-1 flex flex-wrap items-center gap-4">
                <b className="text-[26px] tracking-tight">{whenLabel}</b>
                <Link href={`/class/${next.id}`} className="btn"><Icon name="class" size="sm" />{t("cls.enter")}</Link>
              </div>
              <div className="small mt-1 opacity-90">{next.template?.title ?? ""}{inMin !== null && inMin > 0 && inMin < 24 * 60 ? ` · ${t("st.startsIn", { n: inMin < 60 ? `${inMin} ${t("dash.min")}` : `${Math.round(inMin / 60)} ${t("crs.h")}` })}` : inMin !== null && inMin <= 0 ? ` · ${t("today.live")}` : ""}</div>
            </div>
          ) : <div className="tile"><span className="muted">{t("st.noNext")}</span></div>}

          {hw && (
            <div className="tk flex flex-wrap items-center gap-4" style={{ borderColor: "var(--accent)" }}>
              <div className="grow min-w-[220px] flex-1">
                <h3>{t("st.finishHw")}</h3>
                <p className="small muted mt-2 mb-2">{hw.title}: {t("st.doneOf", { n: hw.done, total: hw.total })}</p>
                <span className="hwbar block max-w-[300px]"><i style={{ width: `${hw.total ? (hw.done / hw.total) * 100 : 0}%` }} /></span>
              </div>
              <Link href={`/class/${hw.lesson.id}?tab=homework`} className="btn primary lg">{t("st.doHw")}</Link>
            </div>
          )}

          {last && (last.studentNote || last.note) && (
            <div className="grid gap-3 md:grid-cols-2">
              {last.studentNote && <NoteChecklist lessonId={last.id} title={t("st.myNotes")} text={last.studentNote} />}
              {last.note && <div className="tile" style={{ background: "var(--warn-bg)" }}><div className="small mb-2 font-semibold" style={{ color: "var(--warn-text)" }}>{t("st.teacherNotes")}</div>{last.note}</div>}
            </div>
          )}

          <div className="tk flex flex-wrap items-center gap-4">
            <div className="grow min-w-[220px] flex-1">
              <div className="small font-semibold text-accent">{t("nav.words")}</div>
              <h3 className="mt-1">{done >= goal ? t("st.wordsDone") : t("st.trainToday", { n: goal })}</h3>
              <p className="small muted mt-1 mb-2">{t("st.doneOf", { n: done, total: goal })}{dueWords ? ` · ${t("st.due", { n: dueWords })}` : ""}</p>
              <span className="hwbar block max-w-[300px]"><i style={{ width: `${(done / goal) * 100}%` }} /></span>
            </div>
            <Link href="/student/words?train=today" className="btn primary lg">{t("st.startTraining")}</Link>
          </div>
          {allDone && <div className="alert ok">🎉 {t("st.allDone")}</div>}
        </div>
      </section>

      <section className="card">
        <NotificationList items={notifications.map((n) => ({ id: n.id, title: n.title, when: ago(n.createdAt), unread: !n.readAt, done: !!n.doneAt, link: n.link, action: n.action }))} />
      </section>
    </div>
  );
}
