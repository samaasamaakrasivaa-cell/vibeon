import Link from "next/link";
import { Clock } from "@/components/Clock";
import { Icon } from "@/components/Icon";
import { LessonCountdown } from "@/components/LessonCountdown";
import { NotificationList } from "@/components/NotificationList";
import { NoteChecklist } from "@/components/student/NoteChecklist";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { greetingKey, hourIn } from "@/lib/greeting";
import { homeworkFor } from "@/lib/homework";
import { currentStudentLesson, nextStudentLesson } from "@/lib/student/next-lesson";
import { hhmm, isoDay } from "@/lib/time";
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
  const [current, next, last, hws, practice, dueWords, notifications, wordsTotal] = await Promise.all([
    s ? currentStudentLesson(me.id, now) : null,
    s ? nextStudentLesson(me.id, now) : null,
    s ? db.lessonInstance.findFirst({ where: { studentId: s.id, status: "DONE" }, orderBy: { startsAt: "desc" }, include: { template: true } }) : null,
    s ? homeworkFor({ studentId: s.id }) : [],
    s ? db.wordPractice.findUnique({ where: { studentId_day: { studentId: s.id, day: isoDay(now, tz) } } }) : null,
    s ? db.word.count({ where: { studentId: s.id, level: { lt: 4 }, OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }] } }) : 0,
    db.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    s ? db.word.count({ where: { studentId: s.id } }) : 0,
  ]);
  // вводный тест: назначен / начат — карточка «Пройти», готов и показан учителем — «Посмотреть результат»
  const pa = s ? await db.placementAttempt.findFirst({ where: { studentId: s.id, OR: [{ status: { in: ["new", "active"] } }, { status: "reviewed", showResult: true, reviewedAt: { gt: new Date(now.getTime() - 14 * 864e5) } }] }, orderBy: { createdAt: "desc" } }) : null;
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  // «С чего начать» — новичку, пока не закрыл: что уже сделано, отмечаем галочкой
  const tips: Tip[] | null = s && !s.tipsDoneAt ? await (async () => {
    const [slots, practiced, route, tests] = await Promise.all([
      db.studySlot.count({ where: { studentId: s.id } }),
      db.wordPractice.count({ where: { studentId: s.id } }),
      db.roadmap.count({ where: { studentId: s.id, approvedAt: { not: null } } }),
      db.checkpoint.count({ where: { studentId: s.id } }),
    ]);
    return [
      { key: "schedule", icon: "cal", title: t("tips.schedT"), text: t("tips.sched"), href: "/student/schedule", cta: t("tips.schedGo"), done: slots > 0 },
      { key: "words", icon: "cards", title: t("tips.wordsT"), text: t("tips.words"), href: "/student/words", cta: t("tips.wordsGo"), done: practiced > 0 },
      { key: "tg", icon: "telegram", title: t("tips.tgT"), text: t("tips.tg"), href: "/student/profile", cta: t("tips.tgGo"), done: !!me.telegramChatId },
      { key: "route", icon: "route", title: t("tips.routeT"), text: t("tips.route"), done: route > 0 },
      { key: "tests", icon: "target", title: t("tips.testsT"), text: t("tips.tests"), href: "/student/progress?tab=tests", cta: t("tips.testsGo"), done: tests > 0 },
    ];
  })() : null;
  // статусы: титулы, выведенные учителем на главный экран (главный — под именем, корона на аватарке); новые — праздничным окном
  const [mains, fresh] = s ? await Promise.all([
    db.award.findMany({ where: { studentId: s.id, kind: "title", onMain: true, OR: [{ until: null }, { until: { gt: now } }] }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] }),
    db.award.findMany({ where: { studentId: s.id, seenAt: null, createdAt: { gt: new Date(now.getTime() - 30 * 864e5) } }, orderBy: { createdAt: "asc" } }),
  ]) : [[], []];
  const pinned = mains.find((a) => a.pinned) ?? null;
  const others = mains.filter((a) => a !== pinned);
  const hw = hws.find((h) => h.done < h.total);
  const goal = s?.wordGoal ?? 15;
  const done = Math.min(goal, practice?.count ?? 0);
  const shownLesson = current ?? next;
  const isToday = shownLesson && isoDay(shownLesson.startsAt, tz) === isoDay(now, tz);
  const whenLabel = shownLesson ? `${isToday ? t("dash.today") : shownLesson.startsAt.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: tz })}, ${hhmm(shownLesson.startsAt, tz)}` : "";
  const allDone = !hw && done >= goal && wordsTotal > 0;
  const ago = (d: Date) => { const m = Math.round((now.getTime() - d.getTime()) / 60000); return m < 60 ? t("nt.minAgo", { n: Math.max(1, m) }) : m < 1440 ? t("nt.hAgo", { n: Math.round(m / 60) }) : d.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz }); };

  return (
    <div className="page">
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
          {shownLesson ? (
            <div className="nextcard">
              <div className="small opacity-90">{t("st.next")}</div>
              <div className="mt-1 flex flex-wrap items-center gap-4">
                <b className="text-[26px] tracking-tight">{whenLabel}</b>
                <Link href={`/class/${shownLesson.id}`} className="btn"><Icon name="class" size="sm" />{t("cls.enter")}</Link>
              </div>
              <div className="small mt-1 opacity-90">{[shownLesson.template?.title, current ? t("today.live") : null].filter(Boolean).join(" · ")}</div>
              {!current && next && <LessonCountdown startsAt={next.startsAt.getTime()} initialNow={now.getTime()} variant="student" />}
            </div>
          ) : <div className="tile"><span className="muted">{t("st.noNext")}</span></div>}

          {pa && pa.status !== "reviewed" && (
            <div className="placecard">
              <div className="flex flex-wrap items-center gap-4">
                <div className="grow min-w-[220px] flex-1">
                  <div className="small font-semibold" style={{ color: "#AF52DE" }}>{t("pl.title")}</div>
                  <h3 className="mt-1 text-[21px]">{pa.status === "active" ? t("pl.cardContinue") : t("pl.cardNew")}</h3>
                  <p className="small muted mt-1 mb-0">{t("pl.cardSub")}</p>
                </div>
                <Link href={`/placement/${pa.id}`} className="btn primary lg">{pa.status === "active" ? t("pl.continue") : t("pl.start")}</Link>
              </div>
              <div className="plab mt-4">{t("pl.whyT")}</div>
              <ul>{(["pl.why1", "pl.why2", "pl.why3", "pl.why4"] as const).map((k) => <li key={k}><Icon name="check" size="sm" /><span>{t(k)}</span></li>)}</ul>
            </div>
          )}

          {pa && pa.status === "reviewed" && (
            <div className="tk flex flex-wrap items-center gap-4" style={{ borderColor: "var(--accent)" }}>
              <div className="grow min-w-[220px] flex-1">
                <div className="small font-semibold text-accent">{t("pl.title")}</div>
                <h3 className="mt-1">{pa.status === "reviewed" ? t("pl.cardDone", { lvl: pa.level ?? "" }) : pa.status === "active" ? t("pl.cardContinue") : t("pl.cardNew")}</h3>
                <p className="small muted mt-1 mb-0">{pa.status === "reviewed" ? t("pl.cardDoneSub") : t("pl.cardSub")}</p>
              </div>
              <Link href={pa.status === "reviewed" ? `/student/test/${pa.checkpointId}` : `/placement/${pa.id}`} className="btn primary lg">{pa.status === "reviewed" ? t("pl.cardSee") : pa.status === "active" ? t("pl.continue") : t("pl.start")}</Link>
            </div>
          )}

          {/* домашка, которую преподаватель задал после последнего урока: большая кнопка и сколько заданий осталось */}
          {hw && (
            <Link href={`/class/${hw.lesson.id}?tab=homework`} className="hwbig">
              <span className="hwico"><Icon name="clip" size="lg" /></span>
              <span className="grow min-w-0">
                <b>{t("st.doHwBig")}</b>
                <span className="small mt-1 block opacity-90">{hw.title} · {t("st.hwLeft", { n: hw.total - hw.done, total: hw.total })}</span>
                <span className="hwbar mt-2 block"><i style={{ width: `${hw.total ? (hw.done / hw.total) * 100 : 0}%` }} /></span>
              </span>
              <span className="hwgo"><Icon name="right" /></span>
            </Link>
          )}

          {last && (last.studentNote || last.note) && (
            <div className="grid gap-3 md:grid-cols-2">
              {last.studentNote && <NoteChecklist lessonId={last.id} title={t("st.myNotes")} text={last.studentNote} />}
              {last.note && <div className="tile" style={{ background: "var(--warn-bg)" }}><div className="small mb-2 font-semibold" style={{ color: "var(--warn-text)" }}>{t("st.teacherNotes")}</div>{last.note}</div>}
            </div>
          )}

          {wordsTotal === 0 ? (
            <div className="tk">
              <div className="small font-semibold text-accent">{t("nav.words")}</div>
              <p className="muted mb-0 mt-1">{t("st.noWordsYet")}</p>
            </div>
          ) : (
          <div className="tk flex flex-wrap items-center gap-4">
            <div className="grow min-w-[220px] flex-1">
              <div className="small font-semibold text-accent">{t("nav.words")}</div>
              <h3 className="mt-1">{done >= goal ? t("st.wordsDone") : t("st.trainToday", { n: goal })}</h3>
              <p className="small muted mt-1 mb-2">{t("st.doneOf", { n: done, total: goal })}{dueWords ? ` · ${t("st.due", { n: dueWords })}` : ""}</p>
              <span className="hwbar block max-w-[300px]"><i style={{ width: `${(done / goal) * 100}%` }} /></span>
            </div>
            <Link href="/student/words?train=today" className="btn primary lg">{t("st.startTraining")}</Link>
          </div>
          )}
          {allDone && <div className="alert ok">🎉 {t("st.allDone")}</div>}
        </div>
      </section>

      {tips && <StartTips tips={tips} />}
      {fresh.length > 0 && <CelebrateAwards items={fresh.map((a) => ({ id: a.id, kind: a.kind, name: a.name, why: a.why, icon: a.icon, color: a.color, until: a.until ? a.until.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz }) : null }))} />}
      <section className="card">
        <NotificationList items={notifications.map((n) => ({ id: n.id, title: n.title, when: ago(n.createdAt), unread: !n.readAt, done: !!n.doneAt, link: n.link, action: n.action }))} />
      </section>
    </div>
  );
}
