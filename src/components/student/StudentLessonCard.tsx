import Link from "next/link";
import { Icon } from "@/components/Icon";
import { LessonCountdown } from "@/components/LessonCountdown";
import { getT } from "@/lib/i18n/server";
import { hhmm, isoDay } from "@/lib/time";

type Lesson = { id: string; startsAt: Date; durationMin: number; template: { title: string } | null };
type Homework = { lesson: { id: string; startsAt: Date }; title: string; done: number; total: number; needsRevision: boolean };

export async function StudentLessonCard({ lesson, current, callLink, homework, tz, now }: {
  lesson: Lesson | null;
  current: boolean;
  callLink: string | null;
  homework?: Homework;
  tz: string;
  now: Date;
}) {
  const { t, lang } = await getT();
  const formatDay = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", timeZone: tz });
  const homeworkRow = homework && (
    <div className="student-lesson-homework">
      <div className="flex min-w-0 items-start gap-2">
        <Icon name="clip" size="sm" />
        <div className="min-w-0">
          <b>{t("st.homeworkTitle")}</b>
          <div className="small muted break-words">
            {homework.lesson.id === lesson?.id ? t("st.homeworkSameLesson") : t("st.homeworkFromLesson", { date: formatDay.format(homework.lesson.startsAt) })}
            {homework.title !== "—" && ` · ${homework.title}`}
          </div>
          {homework.needsRevision ? <div className="small muted">{t("stl.hwRevise")}</div> :
            homework.total > homework.done && <div className="small muted">{t("st.hwLeft", { n: homework.total - homework.done, total: homework.total })}</div>}
        </div>
      </div>
      <Link href={`/class/${homework.lesson.id}?tab=homework`} prefetch={false} className="btn secondary sm">{t("st.doHwBig")}</Link>
    </div>
  );
  if (!lesson) {
    return (
      <section className="student-lesson-empty" aria-labelledby="student-lesson-title">
        <h3 id="student-lesson-title">{t("st.next")}</h3>
        <p className="muted m-0">{t("st.noNext")}</p>
        {homeworkRow}
      </section>
    );
  }

  const start = lesson.startsAt;
  const end = new Date(start.getTime() + lesson.durationMin * 60_000);
  const today = isoDay(start, tz) === isoDay(now, tz);
  const soon = start.getTime() - now.getTime() <= 60.5 * 60_000;
  return (
    <section className={`tl student-lesson-card${current ? " now" : soon ? " soon" : ""}`} data-student-lesson-status={current ? "ACTIVE" : "PLANNED"} aria-labelledby="student-lesson-title">
      <header className="student-lesson-heading">
        <h3 id="student-lesson-title">{t(current ? "today.live" : today ? "st.nextToday" : "st.next")}</h3>
        <time className="small muted" dateTime={isoDay(start, tz)}>{formatDay.format(start)}</time>
      </header>
      <div className="tl-time">
        <b><time dateTime={start.toISOString()}>{hhmm(start, tz)}</time></b>
        <span><time dateTime={end.toISOString()}>{hhmm(end, tz)}</time></span>
      </div>
      <div className="tl-main min-w-0">
        <div className="tl-who">
          <span className="avatar lg" aria-hidden="true"><Icon name="cal" size="sm" /></span>
          <span>{lesson.template?.title ?? t("dash.lesson")}</span>
        </div>
        {!current && <div className="tl-what"><LessonCountdown startsAt={start.getTime()} initialNow={now.getTime()} variant="student" compact /></div>}
      </div>
      <div className="tl-act">
        <Link href={`/class/${lesson.id}`} prefetch={false} className="btn primary sm"><Icon name="class" size="sm" />{t("cls.enter")}</Link>
        {callLink ? <a href={callLink} className="btn secondary sm" target="_blank" rel="noreferrer"><Icon name="phone" size="sm" />{t("cls.joinCall")}</a> :
          <p className="student-lesson-no-call small muted"><Icon name="link" size="sm" />{t("st.noCallLink")}</p>}
        <div className="tl-quick">
          <Link href="/student/messages" className="btn plain sm" title={t("st.requestInChat")}><Icon name="move" size="sm" />{t("sch.move")}</Link>
          <Link href="/student/messages" className="btn plain sm" title={t("st.requestInChat")}><Icon name="calx" size="sm" />{t("st.cancelShort")}</Link>
        </div>
      </div>
      {homeworkRow}
    </section>
  );
}
