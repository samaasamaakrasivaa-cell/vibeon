import Link from "next/link";
import { Clock } from "@/components/Clock";
import { Icon } from "@/components/Icon";
import { NotificationList } from "@/components/NotificationList";
import { NoteChecklist } from "@/components/student/NoteChecklist";
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
export default async function StudentHome() {
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
    return [
      { key: "form", icon: "pencil", title: t("tips.formT"), text: t("tips.form"), href: "/student/profile#questionnaire", cta: t(formDone ? "tips.formEdit" : "tips.formGo"), done: formDone, keepLink: true },
      { key: "tg", icon: "telegram", title: t("tips.tgT"), text: t("tips.tg"), href: "/student/profile#notify", cta: t("tips.tgGo"), done: !!me.telegramChatId },
      { key: "schedule", icon: "cal", title: t("tips.schedT"), text: t("tips.sched"), href: "/student/schedule", cta: t("tips.schedGo"), done: !!slot, keepLink: true },
      {
        key: "test", icon: "target", title: t("tips.testsT"),
        text: t(testDone ? "tips.testsDone" : testLink ? "tips.testsAssigned" : "tips.tests"),
        href: testLink ?? resultLink ?? undefined,
        cta: t(testDone ? "pl.cardSee" : taking?.status === "active" ? "pl.continue" : "pl.start"),
        done: testDone, locked: testLink || testDone ? undefined : t("tips.testsLocked"), keepLink: true,
      },
      { key: "route", icon: "route", title: t("tips.routeT"), text: t("tips.route"), href: "/student/route", cta: t("tips.routeGo"), done: !!route?.approvedAt, locked: route?.approvedAt ? undefined : t("tips.routeLocked"), keepLink: true },
    ];
  })() : null;
  // статусы: титулы, выведенные учителем на главный экран (главный — под именем, корона на аватарке); новые — праздничным окном
  const [mains, fresh] = s ? await Promise.all([
    db.award.findMany({ where: { studentId: s.id, kind: "title", onMain: true, OR: [{ until: null }, { until: { gt: now } }] }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] }),
    db.award.findMany({ where: { studentId: s.id, seenAt: null, createdAt: { gt: new Date(now.getTime() - 30 * 864e5) } }, orderBy: { createdAt: "asc" } }),
  ]) : [[], []];
  const pinned = mains.find((a) => a.pinned) ?? null;
  const others = mains.filter((a) => a !== pinned);
  const pendingHomework = hws.find((h) => h.done < h.total);
  const hw = pendingHomework ?? (hws[0]?.words ? hws[0] : undefined);
  const goal = s?.wordGoal ?? 15;
  const done = Math.min(goal, practice?.count ?? 0);
  const shownLesson = current ?? next;
  const callLink = shownLesson ? await studentLessonCallLink(me.id, shownLesson.id) : null;
  const needsWordGoal = studentForm(s?.form).wordGoalConfigured === false;
  const wordTime = s?.wordDays.includes(partsIn(now, tz).dow) ? s.remindAt : null;
  const allDone = !pendingHomework && done >= goal && wordsTotal > 0;
  const ago = (d: Date) => { const m = Math.round((now.getTime() - d.getTime()) / 60000); return m < 60 ? t("nt.minAgo", { n: Math.max(1, m) }) : m < 1440 ? t("nt.hAgo", { n: Math.round(m / 60) }) : d.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz }); };

  return (
    <div className="page">
      {tips && <StartTips tips={tips} />}
      <section className="card">
        {s?.avatarNotice && <AvatarNotice id={s.id} avatar={s.avatar} />}
        <div className="flex flex-wrap items-center justify-between gap-6 border-b border-sep pb-6">
          <div className={mains.length && s ? "stgreet" : undefined}>
            {mains.length > 0 && s && <Link href="/student/profile#avatar" className="stgreet-av" aria-label={t("av.title")}><StudentAvatar id={s.id} avatar={s.avatar} size={104} crown={!!pinned} /></Link>}
            <div className="min-w-0">
              <div className="text-[19px] text-text2">{t(greetingKey(hourIn(tz)))}</div>
              <div className="gname">{me.name}</div>
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
          <Clock lang={lang} tz={tz} />
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <StudentLessonCard lesson={shownLesson} current={!!current} callLink={callLink} homework={hw} tz={tz} now={now} />

          {testLink && (
            <div className="placecard">
              <div className="flex flex-wrap items-center gap-4">
                <div className="grow min-w-[220px] flex-1">
                  <div className="small font-semibold text-violet">{t(taking?.track === "teen" ? "plt.title" : "pl.title")}</div>
                  <h3 className="mt-1 text-[21px]">{t(taking?.status === "active" ? "pl.cardContinue" : "pl.cardNew")}</h3>
                  <p className="small muted mt-1 mb-0">{t("st.placementIntro")}</p>
                  {taking && <p className="small muted mt-1 mb-0">{t("pl.cardSub")}</p>}
                </div>
                <Link href={testLink} className="btn primary lg">{t(taking?.status === "active" ? "pl.continue" : "pl.start")}</Link>
              </div>
              <div className="plab mt-4">{t("pl.whyT")}</div>
              <ul>{(["st.placementHonest", "st.placementHelp"] as const).map((k) => <li key={k}><Icon name="check" size="sm" /><span>{t(k)}</span></li>)}</ul>
            </div>
          )}

          {!testLink && publishedTest && resultLink && (
            <div className="tk flex flex-wrap items-center gap-4 border-accent">
              <div className="grow min-w-[220px] flex-1">
                <div className="small font-semibold text-accent">{t(publishedTest.track === "teen" ? "plt.title" : "pl.title")}</div>
                <h3 className="mt-1">{t("pl.cardDone", { lvl: publishedTest.level ?? "" })}</h3>
                <p className="small muted mt-1 mb-0">{t("pl.cardDoneSub")}</p>
              </div>
              <Link href={resultLink} className="btn primary lg">{t("pl.cardSee")}</Link>
            </div>
          )}

          {needsWordGoal ? (
            <div className="tk flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="small font-semibold text-accent">{t("nav.words")}</div>
                <p className="muted mb-0 mt-1">{t("tips.words")}</p>
              </div>
              <Link href="/student/words?goal=1" className="btn primary">{t("tips.wordsT")}</Link>
            </div>
          ) : wordsTotal === 0 ? (
            <div className="tk">
              <div className="small font-semibold text-accent">{t("nav.words")}</div>
              <p className="muted mb-0 mt-1">{t("st.noWordsYet")}</p>
            </div>
          ) : (
          <div className="tl" data-student-lesson-status="PLANNED">
            <div className="tl-time">
              {wordTime ? <><b>{wordTime}</b><span>{t("dash.today")}</span></> : <span className="avatar lg"><Icon name="cards" size="sm" /></span>}
            </div>
            <div className="tl-main min-w-0">
              <div className="tl-who">{t("st.wordPractice")}</div>
              <p className="small muted mt-1 mb-2">{done >= goal ? t("st.wordsDone") : t("st.doneOf", { n: done, total: goal })}{dueWords && done < goal ? ` · ${t("st.due", { n: dueWords })}` : ""}</p>
              <span className="hwbar block max-w-[300px]"><i style={{ width: `${(done / goal) * 100}%` }} /></span>
            </div>
            <div className="tl-act">
              <Link href="/student/words?train=today" className="btn primary sm"><Icon name="cards" size="sm" />{t("st.startTraining")}</Link>
            </div>
          </div>
          )}
          {last && (last.studentNote || last.note) && (
            <div className="grid gap-3 md:grid-cols-2">
              {last.studentNote && <NoteChecklist lessonId={last.id} title={t("st.myNotes")} text={last.studentNote} />}
              {last.note && <div className="tile" style={{ background: "var(--warn-bg)" }}><div className="small mb-2 font-semibold" style={{ color: "var(--warn-text)" }}>{t("st.teacherNotes")}</div>{last.note}</div>}
            </div>
          )}
          {allDone && <div className="alert ok">🎉 {t("st.allDone")}</div>}
        </div>
      </section>

      {fresh.length > 0 && <CelebrateAwards items={fresh.map((a) => ({ id: a.id, kind: a.kind, name: a.name, why: a.why, icon: a.icon, color: a.color, until: a.until ? a.until.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz }) : null }))} />}
      <section className="card">
        <NotificationList items={notifications.map((n) => ({ id: n.id, title: n.title, when: ago(n.createdAt), unread: !n.readAt, done: !!n.doneAt, link: n.link, action: n.action }))} />
      </section>
    </div>
  );
}
