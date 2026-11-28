import Link from "next/link";
import { Clock } from "@/components/Clock";
import { Icon } from "@/components/Icon";
import { NotificationList } from "@/components/NotificationList";
import { NoteChecklist } from "@/components/student/NoteChecklist";
import { StudentHomeWeek } from "@/components/student/StudentHomeWeek";
import { StudentLessonCard } from "@/components/student/StudentLessonCard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { greetingKey, hourIn } from "@/lib/greeting";
import { homeworkFor } from "@/lib/homework";
import { currentStudentLesson, nextStudentLesson, studentLessonCallLink } from "@/lib/student/next-lesson";
import { learningAnswers, studentForm } from "@/lib/student/form";
import { isoDay, partsIn } from "@/lib/time";
import { Medal, StudentAvatar } from "@/components/awards/Medal";
import { AvatarNotice, CelebrateAwards } from "@/components/awards/StudentAwards";
import { StartTips, type Tip } from "@/components/student/StartTips";

export const dynamic = "force-dynamic";

/** «Обновления» ученика: следующий урок, домашка, заметки, слова на сегодня, лента событий. */
export default async function StudentHome({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  const tz = me.timezone;
  const now = new Date();
  const [current, next, last, hws, practice, dueWords, notifications, wordsTotal, taking, taken, publishedTest] = await Promise.all([
    s ? currentStudentLesson(me.id, now) : null,
    s ? nextStudentLesson(me.id, now) : null,
    s ? db.lessonInstance.findFirst({ where: { studentId: s.id, status: "DONE" }, orderBy: { startsAt: "desc" }, include: { template: true } }) : null,
    s ? homeworkFor({ studentId: s.id }) : [],
    s ? db.wordPractice.findUnique({ where: { studentId_day: { studentId: s.id, day: isoDay(now, tz) } } }) : null,
    s ? db.word.count({ where: { studentId: s.id, level: { lt: 4 }, OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }] } }) : 0,
    db.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    s ? db.word.count({ where: { studentId: s.id } }) : 0,
    s ? db.placementAttempt.findFirst({
      where: { studentId: s.id, mode: "student", status: { in: ["new", "active"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, track: true },
    }) : null,
    s ? db.placementAttempt.findFirst({
      where: { studentId: s.id, mode: "student", status: { in: ["submitted", "reviewed"] } },
      select: { id: true },
    }) : null,
    s ? db.placementAttempt.findFirst({
      where: {
        studentId: s.id, mode: "student", status: "reviewed", showResult: true, checkpointId: { not: null },
        reviewedAt: { gt: new Date(now.getTime() - 14 * 86_400_000) },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { checkpointId: true, level: true, track: true },
    }) : null,
  ]);
  const legacyEntry = s && !taking && !taken ? await db.checkpoint.findFirst({
    where: { studentId: s.id, kind: "entry", source: "test" },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true },
  }) : null;
  const testLink = taking ? `/placement/${taking.id}` : legacyEntry?.status === "assigned" ? `/student/test/${legacyEntry.id}` : null;
  const resultLink = publishedTest?.checkpointId ? `/student/test/${publishedTest.checkpointId}` : null;
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  // «С чего начать» — новичку, пока не закрыл: что уже сделано, отмечаем галочкой
  const tips: Tip[] | null = s && !s.tipsDoneAt ? await (async () => {
    const [slot, route] = await Promise.all([
      db.studySlot.findFirst({ where: { studentId: s.id }, select: { id: true } }),
      db.roadmap.findFirst({ where: { studentId: s.id }, orderBy: { createdAt: "desc" }, select: { approvedAt: true } }),
    ]);
    const formDone = Object.values(learningAnswers(s.form)).some((answer) => answer.length > 0);
    const testDone = !testLink && (!!taken || legacyEntry?.status === "done");
    const steps: Tip[] = [
      { key: "form", icon: "pencil", title: t("tips.formT"), text: t("tips.form"), href: "/student/profile#questionnaire", cta: t(formDone ? "tips.formEdit" : "tips.formGo"), done: formDone, keepLink: true },
      { key: "tg", icon: "telegram", title: t("tips.tgT"), text: t("tips.tg"), href: "/student/profile#notify", cta: t("tips.tgGo") },
      {
        key: "test", icon: "target", title: t("tips.testsT"),
        text: t(testDone ? "tips.testsDone" : "tips.testsAssigned"),
        href: testLink ?? resultLink ?? undefined,
        cta: t(testDone ? "pl.cardSee" : taking?.status === "active" ? "pl.continue" : "pl.start"),
        done: testDone, locked: testLink || testDone ? undefined : t("tips.testsLocked"), keepLink: true,
      },
      { key: "schedule", icon: "cal", title: t("tips.schedT"), text: t("tips.sched"), href: "/student/schedule", cta: t("tips.schedGo"), done: !!slot, keepLink: true },
      { key: "route", icon: "mountain", title: t("tips.routeT"), text: t("tips.route"), href: "/student/route", cta: t("tips.routeGo"), done: !!route?.approvedAt, locked: route?.approvedAt ? undefined : t("tips.routeLocked"), keepLink: true },
    ];
    return steps.filter(({ key }) => !me.telegramChatId || key !== "tg");
  })() : null;
  // статусы: титулы, выведенные учителем на главный экран (главный — под именем, корона на аватарке); новые — праздничным окном
  const [mains, fresh] = s ? await Promise.all([
    db.award.findMany({ where: { studentId: s.id, kind: "title", onMain: true, OR: [{ until: null }, { until: { gt: now } }] }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] }),
    db.award.findMany({ where: { studentId: s.id, seenAt: null, createdAt: { gt: new Date(now.getTime() - 30 * 864e5) } }, orderBy: { createdAt: "asc" } }),
  ]) : [[], []];
  const pinned = mains.find((a) => a.pinned) ?? null;
  const others = mains.filter((a) => a !== pinned);
  const goal = s?.wordGoal ?? 15;
  const done = Math.min(goal, practice?.count ?? 0);
  const shownLesson = current ?? next;
  const [callLink, lessonWork] = await Promise.all([
    shownLesson ? studentLessonCallLink(me.id, shownLesson.id) : null,
    shownLesson && s ? homeworkFor({ studentId: s.id }, [shownLesson.id]) : [],
  ]);
  const homeworkForLesson = lessonWork[0];
  const pendingHomework = hws.find((h) => h.needsRevision || h.done < h.total);
  const homeworkPending = homeworkForLesson && (homeworkForLesson.needsRevision || homeworkForLesson.done < homeworkForLesson.total || homeworkForLesson.words > 0 || homeworkForLesson.total === 0);
  const needsWordGoal = studentForm(s?.form).wordGoalConfigured === false;
  const wordTime = s?.wordDays.includes(partsIn(now, tz).dow) ? s.remindAt : null;
  const allDone = !homeworkPending && !pendingHomework && done >= goal && wordsTotal > 0;
  const ago = (d: Date) => { const m = Math.round((now.getTime() - d.getTime()) / 60000); return m < 60 ? t("nt.minAgo", { n: Math.max(1, m) }) : m < 1440 ? t("nt.hAgo", { n: Math.round(m / 60) }) : d.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz }); };

  const wordTrainingToday = !needsWordGoal && wordsTotal > 0 && wordTime !== null;
  const wordsCard = (
    <section className="student-home-task student-home-words" aria-labelledby="student-words-title">
      <header className="student-home-task-head">
        <span className="student-home-task-icon" aria-hidden="true"><Icon name="cards" /></span>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 id="student-words-title">{t(wordTrainingToday ? "st.wordPractice" : "nav.words")}</h3>
          {wordTrainingToday && <span className="small muted">{t("st.wordPracticeAt", { time: wordTime })}</span>}
        </div>
      </header>
      {needsWordGoal || wordsTotal === 0 ? <p className="student-home-task-body m-0 muted">{t(needsWordGoal ? "tips.words" : "st.noWordsYet")}</p> : (
        <div className="student-home-task-body">
          {done === 0 && <p className="m-0 mb-2 muted">{t("st.wordsNotStarted")}</p>}
          {done >= goal && <p className="m-0 mb-2 font-semibold">{t("st.wordsDone")}</p>}
          <div className="student-home-word-count small">
            <b>{t("st.doneOf", { n: done, total: goal })}</b>
            <span className="muted">{dueWords ? t("st.due", { n: dueWords }) : t("st.noWordsDue")}</span>
          </div>
          <span className="hwbar block" role="progressbar" aria-label={t("st.wordPractice")} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={done}><i style={{ width: `${(done / goal) * 100}%` }} /></span>
        </div>
      )}
      {needsWordGoal ? <Link href="/student/words?goal=1" className="btn primary sm"><Icon name="target" size="sm" />{t("tips.wordsT")}</Link> :
          wordsTotal === 0 ? <Link href="/student/words?tab=list" className="btn secondary sm">{t("st.openDictionary")}</Link> :
          <Link href={dueWords ? "/student/words?train=today" : "/student/words?train=all"} className="btn primary sm"><Icon name="cards" size="sm" />{t(dueWords ? "st.startTraining" : "st.reviewWords")}</Link>}
    </section>
  );

  return (
    <div className="page student-home-page">
      {tips && <StartTips tips={tips} />}
      <section className="card student-home-main">
        {s?.avatarNotice && <AvatarNotice id={s.id} avatar={s.avatar} />}
        <div className="student-home-greeting">
          <div className={mains.length && s ? "stgreet" : undefined}>
            {mains.length > 0 && s && <Link href="/student/profile#avatar" className="stgreet-av" aria-label={t("av.title")}><StudentAvatar id={s.id} avatar={s.avatar} size={104} crown={!!pinned} /></Link>}
            <div className="min-w-0">
              <div className="student-greeting-line">
                <span>{t(greetingKey(hourIn(tz)))}</span>
                <span className="gname">{me.name}</span>
              </div>
              {pinned && (
                <span className="awmainline" tabIndex={0}>
                  <Medal icon={pinned.icon} color={pinned.color} size={34} />
                  <b>{pinned.name}</b>
                  <span className="awtip" role="tooltip">{pinned.why && <span>{pinned.why}</span>}<Link href="/student/progress?tab=awards">{t("aw.allMine")} →</Link></span>
                </span>
              )}
              {others.length > 0 && (
                <div className="awothers">
                  {others.map((a) => (
                    <span key={a.id} className="awchip" tabIndex={0}>
                      <Medal icon={a.icon} color={a.color} size={22} />{a.name}
                      <span className="awtip" role="tooltip">{a.why && <span>{a.why}</span>}<Link href="/student/progress?tab=awards">{t("aw.allMine")} →</Link></span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Clock lang={lang} tz={tz} compact />
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {testLink && (
            <section className="student-home-task student-home-placement student-home-placement-active" aria-labelledby="student-placement-title">
              <header className="student-home-task-head">
                <span className="student-home-task-icon" aria-hidden="true"><Icon name="target" /></span>
                <div className="min-w-0">
                  <h3 id="student-placement-title">{t(taking?.status === "active" ? "st.placementInProgress" : "pl.cardNew")}</h3>
                  {taking?.track === "teen" && <span className="small muted">{t("plt.title")}</span>}
                </div>
              </header>
              <Link href={testLink} className="btn plwhite"><Icon name="target" size="sm" />{t(taking?.status === "active" ? "pl.continue" : "pl.start")}</Link>
              <div className="student-home-task-body">
                <p className="m-0 muted"><strong>{t("st.placementIntro")}</strong> {t("st.placementHonest")} {t("st.placementHelp")}</p>
                {taking && <p className="m-0 mt-2 small muted">{t("pl.cardSub")}</p>}
              </div>
            </section>
          )}
          <StudentLessonCard lesson={shownLesson} current={!!current} callLink={callLink} homework={homeworkForLesson} tz={tz} now={now} />
          {wordTrainingToday && wordsCard}
          {s && <StudentHomeWeek studentId={s.id} day={d} tz={tz} now={now} hasWordGoal={!needsWordGoal} shownLessonId={shownLesson?.id} />}
          {!wordTrainingToday && wordsCard}
        </div>
      </section>

      {!testLink && publishedTest && resultLink && (
        <section className="student-home-task student-home-placement" aria-labelledby="student-placement-title">
          <header className="student-home-task-head">
            <span className="student-home-task-icon" aria-hidden="true"><Icon name="target" /></span>
            <div className="min-w-0">
              <h3 id="student-placement-title">{t("pl.cardDone", { lvl: publishedTest.level ?? "" })}</h3>
              {publishedTest.track === "teen" && <span className="small muted">{t("plt.title")}</span>}
            </div>
          </header>
          <p className="student-home-task-body m-0 muted">{t("st.placementResultHint")}</p>
          <Link href={resultLink} prefetch={false} className="btn primary sm">{t("pl.cardSee")}</Link>
        </section>
      )}

      {last && (last.studentNote || last.note) && (
        <div className="grid gap-3 md:grid-cols-2">
          {last.studentNote && <NoteChecklist lessonId={last.id} title={t("st.myNotes")} text={last.studentNote} />}
          {last.note && <div className="tile" style={{ background: "var(--warn-bg)" }}><div className="small mb-2 font-semibold" style={{ color: "var(--warn-text)" }}>{t("st.teacherNotes")}</div>{last.note}</div>}
        </div>
      )}
      {allDone && <div className="alert ok">🎉 {t("st.allDone")}</div>}

      {fresh.length > 0 && <CelebrateAwards items={fresh.map((a) => ({ id: a.id, kind: a.kind, name: a.name, why: a.why, icon: a.icon, color: a.color, until: a.until ? a.until.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz }) : null }))} />}
      <section className="card">
        <NotificationList items={notifications.map((n) => ({ id: n.id, title: n.title, when: ago(n.createdAt), unread: !n.readAt, done: !!n.doneAt, link: n.link, action: n.action }))} />
      </section>
    </div>
  );
}
