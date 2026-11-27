import Link from "next/link";
import { Icon } from "@/components/Icon";
import { LessonCountdown } from "@/components/LessonCountdown";
import { getT } from "@/lib/i18n/server";
import { hhmm, isoDay } from "@/lib/time";

type Lesson = { id: string; startsAt: Date; durationMin: number; template: { title: string } | null };
type Homework = { lesson: { id: string }; title: string; done: number; total: number };

export async function StudentLessonCard({ lesson, current, callLink, homework, tz, now }: {
  lesson: Lesson | null;
  current: boolean;
  callLink: string | null;
  homework?: Homework;
  tz: string;
  now: Date;
}) {
  const { t, lang } = await getT();
  const homeworkAction = homework && (
    <Link href={`/class/${homework.lesson.id}?tab=homework`} className="btn tinted sm">
      <Icon name="clip" size="sm" />{t("st.doHwBig")}
    </Link>
  );
  if (!lesson) {
    return (
      <div className="tile flex flex-wrap items-center justify-between gap-3">
        <span className="muted">{t("st.noNext")}</span>
        {homeworkAction}
      </div>
    );
  }

  const start = lesson.startsAt;
  const end = new Date(start.getTime() + lesson.durationMin * 60_000);
  const date = isoDay(start, tz) === isoDay(now, tz) ? t("dash.today") :
    start.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz });
  return (
    <div className={`tl ${current ? "now" : "soon"}`} data-student-lesson-status={current ? "ACTIVE" : "PLANNED"}>
      <div className="tl-time">
        <b>{hhmm(start, tz)}</b>
        <span>{hhmm(end, tz)}</span>
      </div>
      <div className="tl-main min-w-0">
        <div className="tl-who">
          <span className="avatar lg"><Icon name="cal" size="sm" /></span>
          <div>
            <div>{t(current ? "today.live" : "st.next")}</div>
            <div className="small font-normal muted">{date}</div>
          </div>
        </div>
        {lesson.template && <div className="tl-what"><b>{lesson.template.title}</b></div>}
        {homework && homework.total > homework.done && <p className="tl-what">{homework.title} · {t("st.hwLeft", { n: homework.total - homework.done, total: homework.total })}</p>}
        {!current && <LessonCountdown startsAt={start.getTime()} initialNow={now.getTime()} variant="student" />}
      </div>
      <div className="tl-act">
        <Link href={`/class/${lesson.id}`} className="btn primary sm"><Icon name="class" size="sm" />{t("cls.enter")}</Link>
        {callLink && <a href={callLink} className="btn secondary sm" target="_blank" rel="noreferrer"><Icon name="phone" size="sm" />{t("cls.joinCall")}</a>}
        {homeworkAction}
        <div className="tl-quick">
          <Link href="/student/messages" className="btn plain sm" title={t("st.requestInChat")}><Icon name="move" size="sm" />{t("sch.move")}</Link>
          <Link href="/student/messages" className="btn plain sm" title={t("st.requestInChat")}><Icon name="calx" size="sm" />{t("st.cancelShort")}</Link>
        </div>
      </div>
    </div>
  );
}
