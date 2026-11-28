import Link from "next/link";
import { Icon } from "@/components/Icon";
import { LessonCountdown } from "@/components/LessonCountdown";
import { getT } from "@/lib/i18n/server";
import { hhmm, isoDay } from "@/lib/time";

type Lesson = { id: string; startsAt: Date; durationMin: number; note: string | null; template: { title: string } | null };
type Homework = { done: number; total: number; needsRevision: boolean };

export async function StudentLessonCard({ lesson, current, callLink, homework, tz, now }: {
  lesson: Lesson | null;
  current: boolean;
  callLink: string | null;
  homework?: Homework;
  tz: string;
  now: Date;
}) {
  const { t, lang } = await getT();
  if (!lesson) {
    return (
      <section className="student-lesson-card" aria-labelledby="student-lesson-title">
        <h3 id="student-lesson-title" className="student-lesson-heading">{t("st.yourNextLesson")}</h3>
        <div className="student-lesson-empty">
          <p className="muted m-0">{t("st.noNext")}</p>
        </div>
      </section>
    );
  }

  const start = lesson.startsAt;
  const end = new Date(start.getTime() + lesson.durationMin * 60_000);
  const date = isoDay(start, tz);
  const today = date === isoDay(now, tz);
  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const fullDate = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }).formatToParts(start);
  const datePart = (type: Intl.DateTimeFormatPartTypes) => fullDate.find((part) => part.type === type)?.value;
  const soon = start.getTime() - now.getTime() <= 60.5 * 60_000;
  const exercisesLeft = homework ? homework.total - homework.done : 0;
  const exercisePlural = new Intl.PluralRules(locale).select(exercisesLeft);
  const exercisesLeftKey = exercisePlural === "one" ? "st.homeworkLeftOne" : exercisePlural === "few" ? "st.homeworkLeftFew" : "st.homeworkLeft";
  const homeworkComplete = homework && homework.total > 0 && exercisesLeft === 0 && !homework.needsRevision;
  return (
    <section className="student-lesson-card" aria-labelledby="student-lesson-title">
      <h3 id="student-lesson-title" className="student-lesson-heading">{t(current ? "st.yourCurrentLesson" : "st.yourNextLesson")}</h3>
      <div className={`tl student-lesson-grid${current ? " now" : soon ? " soon" : ""}`} data-student-lesson-status={current ? "ACTIVE" : "PLANNED"}>
        <div className="student-lesson-time">
          <time className="student-lesson-date" dateTime={date}>
            <span className="student-lesson-weekday">{today ? t("dash.today") : datePart("weekday")}</span>
            <b>{datePart("day")}</b>
            <span>{datePart("month")}</span>
            <span className="sr-only">{datePart("year")}</span>
          </time>
          <div>
            <div className="student-lesson-hours">
              <time dateTime={start.toISOString()}>{hhmm(start, tz)}</time>–<time dateTime={end.toISOString()}>{hhmm(end, tz)}</time>
            </div>
            {current && <span className="small font-semibold">{t("today.live")}</span>}
          </div>
        </div>
        <div className="tl-main min-w-0">
          <div className="tl-who">
            <span className="avatar lg" aria-hidden="true"><Icon name="cal" size="sm" /></span>
            <span>{lesson.template?.title ?? t("dash.lesson")}</span>
          </div>
          <div className="student-lesson-homework">
            {homework ? (
              <>
                <Link href={`/class/${lesson.id}?tab=homework`} prefetch={false} className="btn primary student-homework-link">
                  <Icon name="clip" size="sm" />
                  <span>{t(homeworkComplete ? "st.openHomework" : current ? "st.doHomeworkForLesson" : "st.doHomeworkForNextLesson")}</span>
                </Link>
                {homework.total > 0 && (
                  <div className="student-homework-progress">
                    <div className="student-homework-progress-line">
                      <span className="hwbar" role="progressbar" aria-label={t("st.homeworkTitle")}
                        aria-valuemin={0} aria-valuenow={homework.done} aria-valuemax={homework.total}
                        aria-valuetext={t("st.homeworkProgress", { n: homework.done, total: homework.total })}>
                        <i style={{ width: `${(homework.done / homework.total) * 100}%` }} />
                      </span>
                      <b aria-hidden="true">{homework.done}/{homework.total}</b>
                    </div>
                    {exercisesLeft > 0 && <span>{t(exercisesLeftKey, { n: exercisesLeft })}</span>}
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
          {lesson.note && <div className="tl-note student-lesson-note"><Icon name="msg" size="sm" /><span>{lesson.note}</span></div>}
        </div>
        <div className="tl-act">
          <Link href={`/class/${lesson.id}`} prefetch={false} className="btn primary"><Icon name="class" size="sm" />{t("dash.openClass")}</Link>
          {callLink ? <a href={callLink} className="btn secondary" target="_blank" rel="noreferrer"><Icon name="phone" size="sm" />{t("cls.joinCall")}</a> :
            <p className="student-lesson-no-call small muted"><Icon name="phone" size="sm" />{t("st.noCallLink")}</p>}
          <div className="tl-quick">
            <Link href="/student/messages" className="btn plain sm" title={t("st.requestInChat")}><Icon name="move" size="sm" />{t("sch.move")}</Link>
            <Link href="/student/messages" className="btn plain sm" title={t("st.requestInChat")}><Icon name="calx" size="sm" />{t("sch.cancelLesson")}</Link>
          </div>
        </div>
        {!current && <LessonCountdown startsAt={start.getTime()} initialNow={now.getTime()} variant="student" compact />}
      </div>
    </section>
  );
}
