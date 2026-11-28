import Link from "next/link";
import { Icon } from "@/components/Icon";
import { LessonCountdown } from "@/components/LessonCountdown";
import { getT } from "@/lib/i18n/server";
import { hhmm, isoDay } from "@/lib/time";

type Lesson = { id: string; startsAt: Date; durationMin: number; note: string | null; template: { title: string } | null };
type Homework = { lesson: { id: string; startsAt: Date }; done: number; total: number; needsRevision: boolean };

export async function StudentLessonCard({ lesson, current, callLink, homework, previousHomework, tz, now }: {
  lesson: Lesson | null;
  current: boolean;
  callLink: string | null;
  homework?: Homework;
  previousHomework?: Homework;
  tz: string;
  now: Date;
}) {
  const { t, lang } = await getT();
  const formatDay = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", timeZone: tz });
  const homeworkLink = (h: Homework) => `/class/${h.lesson.id}?tab=homework`;
  const previous = previousHomework && (
    <div className="student-previous-homework">
      <span>{t("st.homeworkFromLesson", { date: formatDay.format(previousHomework.lesson.startsAt) })}</span>
      <Link href={homeworkLink(previousHomework)} prefetch={false} className="alink">
        {t("st.openHomework")}
      </Link>
    </div>
  );

  if (!lesson) {
    return (
      <section className="student-lesson-card" aria-labelledby="student-lesson-title">
        <h3 id="student-lesson-title" className="student-lesson-heading">{t("st.yourNextLesson")}</h3>
        <div className="student-lesson-empty">
          <p className="muted m-0">{t("st.noNext")}</p>
          {previous}
        </div>
      </section>
    );
  }

  const start = lesson.startsAt;
  const end = new Date(start.getTime() + lesson.durationMin * 60_000);
  const date = isoDay(start, tz);
  const today = date === isoDay(now, tz);
  const soon = start.getTime() - now.getTime() <= 60.5 * 60_000;
  const homeworkComplete = homework && homework.total > 0 && homework.done >= homework.total && !homework.needsRevision;
  return (
    <section className="student-lesson-card" aria-labelledby="student-lesson-title">
      <h3 id="student-lesson-title" className="student-lesson-heading">{t(current ? "st.yourCurrentLesson" : "st.yourNextLesson")}</h3>
      <div className={`tl student-lesson-grid${current ? " now" : soon ? " soon" : ""}`} data-student-lesson-status={current ? "ACTIVE" : "PLANNED"}>
        <div className="tl-time student-lesson-time">
          <time className="student-lesson-date" dateTime={date}>{today ? t("dash.today") : formatDay.format(start)}</time>
          <b><time dateTime={start.toISOString()}>{hhmm(start, tz)}</time></b>
          <span><time dateTime={end.toISOString()}>{hhmm(end, tz)}</time></span>
          <em>{t(current ? "today.live" : "sch.st.planned")}</em>
          {!current && <LessonCountdown startsAt={start.getTime()} initialNow={now.getTime()} variant="student" compact />}
        </div>
        <div className="tl-main min-w-0">
          <div className="tl-who">
            <span className="avatar lg" aria-hidden="true"><Icon name="cal" size="sm" /></span>
            <span>{lesson.template?.title ?? t("dash.lesson")}</span>
          </div>
          {lesson.note && <div className="tl-note student-lesson-note"><Icon name="msg" size="sm" /><span>{lesson.note}</span></div>}
          <div className="student-lesson-homework">
            {homework ? (
              <>
                <Link href={homeworkLink(homework)} prefetch={false} className="btn primary">
                  <Icon name="clip" size="sm" />{t(homeworkComplete ? "st.openHomework" : "st.doHomeworkForLesson")}
                </Link>
                {homework.total > 0 && (
                  <div className="student-homework-progress">
                    <span>{t("st.homeworkProgress", { n: homework.done, total: homework.total })}</span>
                    <progress value={homework.done} max={homework.total} aria-label={t("st.homeworkTitle")} />
                  </div>
                )}
                {homework.needsRevision && <span className="small">{t("stl.hwRevise")}</span>}
              </>
            ) : (
              <div className="student-homework-empty">
                <Icon name="clip" size="sm" />
                <div>
                  <b>{t("st.homeworkTitle")}</b>
                  <p>{t("st.homeworkNotAssigned")}</p>
                  <Link href="/student/messages" className="alink">{t("st.askHomework")}</Link>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="tl-act">
          <Link href={`/class/${lesson.id}`} prefetch={false} className="btn primary sm"><Icon name="class" size="sm" />{t("dash.openClass")}</Link>
          {callLink ? <a href={callLink} className="btn secondary sm" target="_blank" rel="noreferrer"><Icon name="phone" size="sm" />{t("cls.joinCall")}</a> :
            <p className="student-lesson-no-call small muted"><Icon name="phone" size="sm" />{t("st.noCallLink")}</p>}
          <div className="tl-quick">
            <Link href="/student/messages" className="btn plain sm" title={t("st.requestInChat")}><Icon name="move" size="sm" />{t("sch.move")}</Link>
            <Link href="/student/messages" className="btn plain sm" title={t("st.requestInChat")}><Icon name="calx" size="sm" />{t("st.cancelShort")}</Link>
          </div>
        </div>
      </div>
      {previous}
    </section>
  );
}
