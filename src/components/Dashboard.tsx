import Link from "next/link";
import { Clock } from "./Clock";
import { GroupAvatar } from "./teacher/Groups";
import { Icon } from "./Icon";
import { NotificationList } from "./NotificationList";
import { MomentsCard } from "./teacher/MomentsCard";
import { momentsFor } from "@/lib/teacher/moments";
import { HideSteps } from "./teacher/HideSteps";
import { TgConnect } from "./TgConnect";
import { tgEnabled } from "@/lib/notify/telegram";
import { LessonQuick } from "./teacher/WeekGrid";
import { AfterNote } from "./teacher/AfterNote";
import { StudentAvatar } from "./awards/Medal";
import { nextBirthday } from "@/lib/birthdays";
import { getT } from "@/lib/i18n/server";
import { greetingKey, hourIn } from "@/lib/greeting";
import { db } from "@/lib/db";
import { addDaysIso, dayStart, hhmm, isoDay, mondayOf, parseIsoDay, weekRange } from "@/lib/time";
import { lessonInclude, lessonWho, oneSlot, syncSchedule } from "@/lib/teacher/data";
import { initials } from "@/lib/invite";
import { homeworkFor, type HwState } from "@/lib/homework";
import { hasStartedLessonSession } from "@/lib/live/lesson-session";
import { LessonCountdown } from "./LessonCountdown";
import { LessonCall } from "./teacher/LessonCall";
import { callLinkOf } from "@/lib/lessons/call-link";
import { assignedHomeworkTasks } from "@/lib/tasks/homework-selection";
import type { LessonInstance, User } from "@prisma/client";

type ScheduledLesson = Pick<LessonInstance, "startsAt" | "status" | "live" | "callLink" | "templateId">;

function teacherLessonCardStatus(lesson: LessonInstance, host: ScheduledLesson | undefined, now: Date) {
  if (!host || host.status !== lesson.status || +host.startsAt !== +lesson.startsAt) return;
  if (hasStartedLessonSession(host)) {
    if (lesson.status === "PLANNED") return "ACTIVE";
    if (lesson.status === "DONE") return "DONE";
  }
  if (lesson.isTrial || lesson.movedFrom || lesson.groupId || lesson.slotId) return;
  if (lesson.status === "DONE") return "DONE";
  if (lesson.status === "PLANNED" && lesson.startsAt > now) return "PLANNED";
}

/** Главный экран «Обновления»: приветствие, часы, «Сегодня», неделя, «Что нового». */
export async function Dashboard({ user, role, day, top }: { user: User; role: "TEACHER" | "STUDENT"; day?: string; top?: React.ReactNode }) {
  const { t, lang } = await getT();
  const tz = user.timezone;
  const now = new Date();
  const todayIso = isoDay(now, tz);
  const sel = day && parseIsoDay(day) && addDaysIso(day, 0) === day && day < addDaysIso(todayIso, 7)
      && (role === "TEACHER" || day >= todayIso) ? day : todayIso;
  const isToday = sel === todayIso;
  const daysBack = (Date.parse(todayIso) - Date.parse(sel)) / 864e5;
  const windowStart = daysBack > 0 ? addDaysIso(todayIso, -7 * Math.ceil(daysBack / 7)) : todayIso;
  const from = dayStart(windowStart, tz);
  const to = dayStart(addDaysIso(windowStart, 7), tz);
  const dayHref = (iso: string) => iso === todayIso ? "?" : `?d=${iso}`;
  if (role === "TEACHER") await syncSchedule(user.id);

  const where = role === "TEACHER" ? { teacherId: user.id } : { student: { userId: user.id } };
  const [lessonsAll, notifications, hws] = await Promise.all([
    db.lessonInstance.findMany({ where: { ...where, startsAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, include: lessonInclude, orderBy: { startsAt: "asc" } }),
    // сделанные (галочка) уходят из списка через сутки; непрочитанные висят, пока их не откроют;
    // прочитанные без действия (просто новость) — тоже через сутки после прочтения; с действием — пока не отмечены сделанными
    db.notification.findMany({
      where: { userId: user.id, OR: [{ doneAt: { gt: new Date(Date.now() - 864e5) } }, { doneAt: null, OR: [{ readAt: null }, { action: { not: null } }, { readAt: { gt: new Date(Date.now() - 864e5) } }] }] },
      orderBy: { createdAt: "desc" }, take: 15,
    }),
    role === "TEACHER" ? homeworkFor({ teacherId: user.id }) : Promise.resolve([]),
  ]);
  const lessons = role === "TEACHER" ? oneSlot(lessonsAll) : lessonsAll; // групповое занятие у учителя — одной строкой
  // домашка к уроку = домашка с предыдущего занятия этого ученика
  const hwBefore = (studentId: string | null, at: Date) => (studentId ? hws.find((h) => h.lesson.studentId === studentId && h.lesson.startsAt < at) ?? null : null);
  const hwPill = { review: ["orange", "hwT.review"], partial: ["blue", "hwT.partial"], notdone: ["red", "hwT.notdone"], checked: ["green", "hwT.checked"] } as const satisfies Record<HwState, readonly [string, string]>;

  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const todayLessons = lessons.filter((l) => isoDay(l.startsAt, tz) === sel);
  const slotIds = role === "TEACHER" ? todayLessons.flatMap((l) => l.slotId ? [l.slotId] : []) : [];
  // Как в classAccess: состояние группы принадлежит первому по id участнику этого слота.
  const slotMembers = slotIds.length ? await db.lessonInstance.findMany({
    where: { teacherId: user.id, slotId: { in: slotIds } },
    orderBy: { id: "asc" },
    select: { slotId: true, status: true, startsAt: true, live: true, callLink: true, templateId: true },
  }) : [];
  const hosts = new Map<string, ScheduledLesson>();
  const inconsistentSlots = new Set<string>();
  for (const member of slotMembers) {
    if (!member.slotId) continue;
    const host = hosts.get(member.slotId);
    if (!host) hosts.set(member.slotId, member);
    else if (member.status !== host.status || +member.startsAt !== +host.startsAt) inconsistentSlots.add(member.slotId);
  }
  const statusFor = (lesson: LessonInstance) => {
    if (role !== "TEACHER" || (lesson.slotId && inconsistentSlots.has(lesson.slotId))) return;
    if (sel < todayIso && lesson.status === "DONE") return "DONE";
    if (!isToday) return;
    return teacherLessonCardStatus(lesson, lesson.slotId ? hosts.get(lesson.slotId) : lesson, now);
  };
  const countdownId = role === "TEACHER" ? todayLessons.find((lesson) =>
    lesson.status === "PLANNED" && lesson.startsAt > now && statusFor(lesson) !== "ACTIVE"
  )?.id : undefined;
  // подробности уроков выбранного дня: материал, абонемент, долг, первый урок, день рождения
  const extra = new Map((await db.lessonInstance.findMany({
    where: { ...where, id: { in: todayLessons.map((l) => l.id) } },
    select: {
      id: true, movedFrom: true,
      homework: { select: { manual: true, extraTaskIds: true, removedTaskIds: true, wordTraining: true } },
      template: { select: { title: true, subtitle: true, unit: { select: { title: true, course: { select: { title: true } } } } } },
      student: { select: { id: true, avatar: true, payType: true, birthday: true, packs: { orderBy: { startsAt: "desc" }, take: 1, select: { lessonsLeft: true, lessonsTotal: true } }, invoices: { where: { status: { in: ["SENT", "PROOF_SENT"] } }, select: { id: true, amount: true, status: true } }, _count: { select: { lessons: { where: { status: "DONE" } } } } } },
    },
  })).map((x) => [x.id, x]));
  const canManageHomework = (lesson: LessonInstance) => role === "TEACHER" && lesson.status === "DONE" && !!lesson.studentId;
  const homeworkTemplate = (lesson: LessonInstance) => (lesson.slotId ? hosts.get(lesson.slotId)?.templateId : null) ?? lesson.templateId;
  const homeworkTemplateIds = new Set(todayLessons.filter((lesson) => canManageHomework(lesson) && extra.get(lesson.id)?.homework).map(homeworkTemplate).filter((id) => id !== null));
  const homeworkMaterial = homeworkTemplateIds.size ? await db.lessonTemplate.findMany({
    where: { id: { in: [...homeworkTemplateIds] } },
    select: { id: true, tasks: { select: { id: true, section: true, hidden: true, options: true } } },
  }) : [];
  const tasksByTemplate = new Map(homeworkMaterial.map(({ id, tasks }) => [id, tasks]));
  const homeworkPlural = new Intl.PluralRules(lang);
  const homeworkAction = (lesson: LessonInstance) => {
    const homework = extra.get(lesson.id)?.homework;
    const template = homeworkTemplate(lesson);
    const tasks = homework && template ? assignedHomeworkTasks(tasksByTemplate.get(template) ?? [], homework) : [];
    const count = new Set(tasks.filter((task) => !(task.options as { teacherOnly?: boolean } | null)?.teacherOnly).map((task) => task.id)).size;
    if (count > 0) {
      const form = homeworkPlural.select(count);
      return { reminder: false, label: t(form === "one" ? "today.hwOne" : form === "few" ? "today.hwFew" : "today.hwMany", { n: count }) };
    }
    if (homework?.wordTraining.length) return { reminder: false, label: t("today.hwWords") };
    return { reminder: true, label: t("today.hwAdd") };
  };
  // прошедшие уроки дня: следующий урок того же ученика (группы) — туда уходит «Комментарий после урока»
  const nextOf = new Map(role === "TEACHER" ? await Promise.all(todayLessons.filter((l) => l.startsAt.getTime() + l.durationMin * 60000 <= now.getTime()).map(async (l) => {
    const who = l.groupId ? { groupId: l.groupId } : l.studentId ? { studentId: l.studentId, groupId: null } : null;
    const n = who ? await db.lessonInstance.findFirst({ where: { teacherId: user.id, ...who, status: "PLANNED", startsAt: { gt: l.startsAt } }, orderBy: { startsAt: "asc" }, select: { startsAt: true, note: true } }) : null;
    return [l.id, n ? { date: n.startsAt.toLocaleString(loc, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: tz }), note: n.note } : null] as const;
  })) : []);
  const selTitle = isToday ? t("dash.today") : ((x) => x.charAt(0).toUpperCase() + x.slice(1))(new Date(dayStart(sel, tz).getTime() + 12 * 3600e3).toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: tz }));
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(windowStart, i);
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

  // «С чего начать» — пока учитель не сделал главное: курс, ученик, первый урок
  let steps: { done: boolean; href: string; label: string; sub: string }[] = [];
  let teacherCallLink: string | null = null;
  if (role === "TEACHER") {
    const [courses, students, anyLesson, prof] = await Promise.all([
      db.course.count({ where: { teacherId: user.id } }),
      db.student.count({ where: { teacherId: user.id } }),
      db.lessonInstance.count({ where: { teacherId: user.id } }),
      db.teacherProfile.findUnique({ where: { userId: user.id }, select: { callLink: true, settings: true } }),
    ]);
    const pay = !!(prof?.settings as { payDetails?: string } | null)?.payDetails;
    teacherCallLink = prof?.callLink ?? null;
    steps = [
      { done: students > 0, href: "/teacher/students?invite=1", label: t("fs.invite"), sub: t("fs.inviteSub") },
      { done: anyLesson > 0, href: "/teacher/schedule?new=1", label: t("fs.lesson"), sub: t("fs.lessonSub") },
      { done: courses > 0, href: "/teacher/courses", label: t("fs.course"), sub: t("fs.courseSub") },
      { done: !!prof?.callLink, href: "/teacher/profile", label: t("fs.call"), sub: t("fs.callSub") },
      { done: !!user.telegramChatId, href: "/teacher/profile#notify", label: t("fs.tg"), sub: t("fs.tgSub") },
      { done: pay, href: "/teacher/finance?tab=check", label: t("fs.pay"), sub: t("fs.paySub") },
    ];
    if (steps.slice(0, 3).every((s) => s.done) || (prof?.settings as { firstStepsHidden?: boolean } | null)?.firstStepsHidden) steps = [];
  }

  const moments = role === "TEACHER" ? await momentsFor(user.id, user.timezone) : null;
  const momentStudents = role === "TEACHER" ? (await db.student.findMany({ where: { teacherId: user.id, status: "ACTIVE" }, select: { id: true, name: true, lastName: true }, orderBy: { name: "asc" } })).map((s) => ({ id: s.id, name: [s.name, s.lastName].filter(Boolean).join(" ") })) : [];
  // дни рождения учеников в ближайшие 30 дней (дата — из анкеты)
  const bdays = role === "TEACHER"
    ? (await db.student.findMany({ where: { teacherId: user.id, status: "ACTIVE", birthday: { not: null } }, select: { id: true, name: true, lastName: true, birthday: true } }))
        .map((s) => ({ s, b: nextBirthday(s.birthday!, todayIso) })).filter((x) => x.b.days <= 30).sort((a, b) => a.b.days - b.b.days)
    : [];
  const bdWhen = (n: number) => (n === 0 ? t("bd.today") : n === 1 ? t("bd.tomorrow") : t("bd.inDays", { n }));

  return (
    <div className="page">
      {top}
      {/* ученику без Telegram-бота — напоминание подключить (пропадает, когда подключил) */}
      {role === "STUDENT" && !user.telegramChatId && tgEnabled() && (
        <section className="card tgbanner">
          <span className="tgico"><Icon name="telegram" /></span>
          <div className="grow"><b className="block">{t("tgb.title")}</b><span className="small muted">{t("tgb.text")}</span></div>
          <div className="tgbtn"><TgConnect /></div>
        </section>
      )}
      {steps.length > 0 && (
        <section className="card fscard">
          <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="fsicon">🚀</span><h2 className="m-0">{t("fs.title")}</h2></div><HideSteps /></div>
          <p className="muted mt-2 mb-4">{t("fs.lead", { n: steps.filter((x) => x.done).length, total: steps.length })}</p>
          <div className="fsteps">
            {steps.map((x, i) => (
              <Link key={i} href={x.href} className={`fstep ${x.done ? "done" : ""}`}>
                <span className="fsnum">{x.done ? "✓" : i + 1}</span>
                <span className="grow"><b>{x.label}</b><span className="small muted block">{x.sub}</span></span>
                {!x.done && <Icon name="right" size="sm" />}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-6 border-b border-sep pb-6">
          <div>
            <div className="text-[19px] text-text2">{t(greetingKey(hourIn(tz)))}</div>
            <div className="gname">{user.name}</div>
          </div>
          <Clock lang={lang} tz={tz} />
        </div>

        <h2 className="mt-6 mb-3">{selTitle}</h2>
        {todayLessons.length === 0 ? (
          <div className="tempty">
            <p className="hint m-0">{isToday ? t("dash.noLessons") : t("dash.noLessonsDay")}</p>
            {role === "TEACHER" && <Link href={`${scheduleHref}?w=${mondayOf(sel)}&new=1&date=${sel}`} className="btn secondary sm"><Icon name="plus" size="sm" />{t("dash.addLesson")}</Link>}
          </div>
        ) : (
          <div className="tlist">
            {todayLessons.map((l) => {
              const start = l.startsAt.getTime(), end = start + l.durationMin * 60000;
              const teacherLessonStatus = statusFor(l);
              const studentLive = role === "STUDENT" && start <= now.getTime() && now.getTime() < end;
              const live = studentLive || teacherLessonStatus === "ACTIVE";
              const inMin = Math.round((start - now.getTime()) / 60000);
              const soon = inMin > 0 && inMin <= 60
                && (role === "STUDENT" || (l.status === "PLANNED" && teacherLessonStatus !== "ACTIVE"));
              const who = role === "TEACHER" ? lessonWho(l) : t("dash.lesson");
              const x = extra.get(l.id);
              const st = l.slotId ? null : x?.student; // у группы — без абонемента, долга и дня рождения одного ученика
              const pack = st?.payType === "PACK" ? st.packs[0] : null;
              const debt = st?.invoices.reduce((a, i) => a + i.amount, 0) ?? 0;
              const hw = l.slotId ? null : hwBefore(l.studentId, l.startsAt);
              const currentHomework = canManageHomework(l) ? homeworkAction(l) : null;
              const bday = st?.birthday && isoDay(st.birthday, "UTC").slice(5) === sel.slice(5);
              const first = !!st && !l.isTrial && st._count.lessons === 0;
              const callLink = callLinkOf(
                l.slotId ? l.group?.callLink : l.student?.callLink,
                l.callLink,
                l.slotId ? hosts.get(l.slotId)?.callLink : null,
                teacherCallLink,
              );
              return (
                <div key={l.id} className={`tl ${studentLive ? "now" : soon ? "soon" : ""}`} data-teacher-lesson-status={teacherLessonStatus}>
                  <div className="tl-time">
                    <b className={studentLive ? "text-ok" : ""}>{hhmm(l.startsAt, tz)}</b>
                    <span>{hhmm(new Date(end), tz)}</span>
                    {role === "STUDENT" && soon && <em className="text-accent">{t("today.startsIn", { n: inMin })}</em>}
                    {l.id === countdownId && <LessonCountdown startsAt={start} initialNow={now.getTime()} variant="teacher" />}
                    {live && <em className={studentLive ? "text-ok" : ""}>{t("today.live")}</em>}
                    {teacherLessonStatus === "DONE" && <em>{t("sch.st.done")}</em>}
                    {teacherLessonStatus === "PLANNED" && (!soon || l.id === countdownId) && (
                      <em className="tl-planned-label">{t("sch.st.planned")}</em>
                    )}
                  </div>
                  <div className="tl-main">
                    <div className="tl-who">
                      {/* аватарка — как в анкете ученика; у группы — значок группы */}
                      {st && !l.slotId ? <StudentAvatar id={st.id} avatar={st.avatar} size={44} /> : l.group?.avatar?.startsWith("char:") ? <GroupAvatar avatar={l.group.avatar} size={44} /> : <span className="avatar lg">{l.group ? <Icon name="group" size="sm" /> : initials(...(who.split(" ") as [string, string]))}</span>}
                      {role === "TEACHER" && l.studentId && !l.slotId ? <Link href={`/teacher/students/${l.studentId}`} className="hover:text-accent">{who}</Link> : <span>{who}</span>}
                      {l.isTrial && <span className="pill violet">{t("sch.trial")}</span>}
                      {first && <span className="pill violet">{t("today.first")}</span>}
                      {bday && <span className="pill orange">🎂 {t("today.bday")}</span>}
                    </div>
                    <div className="tl-what">
                      {/* только тема урока — подробности в классе */}
                      {x?.template ? <b>{x.template.title}</b> : <span className="text-text3">{t("today.noMaterial")}</span>}
                      {/* сменить или выбрать урок занятия — откроется класс с выбором урока */}
                      {role === "TEACHER" && <Link href={`/class/${l.id}?pick=1`} className="tl-pick">{x?.template ? t("today.changeLesson") : t("today.pickLesson")}</Link>}
                    </div>
                    {(hw || pack || debt > 0 || x?.movedFrom) && (
                      <div className="tl-tags">
                        {hw && <Link href={`/class/${hw.lesson.id}?tab=homework`} className={`pill ${hwPill[hw.state][0]}`} title={`${hw.title} · ${hw.done}/${hw.total}`}>{t("nav.homework")}: {t(hwPill[hw.state][1]).toLowerCase()}</Link>}
                        {pack && <span className={`pill ${pack.lessonsLeft <= 1 ? "orange" : "grey"}`}>{t("prof.left", { n: pack.lessonsLeft, total: pack.lessonsTotal })}</span>}
                        {debt > 0 && role === "TEACHER" ? (
                          // долг — сразу к подтверждению оплаты в «Финансах» (чек прислан — во вкладку «Проверить»)
                          <Link href={((iv) => `/teacher/finance?tab=check&c=${iv.status === "PROOF_SENT" ? "toCheck" : "waiting"}&hl=${iv.id}#inv-${iv.id}`)(st!.invoices.find((i) => i.status === "PROOF_SENT") ?? st!.invoices[0])} className="pill red" title={t("today.debtGo")}>{t("today.debt", { sum: new Intl.NumberFormat(loc).format(debt) + " ₽" })} →</Link>
                        ) : debt > 0 && <span className="pill red">{t("today.debt", { sum: new Intl.NumberFormat(loc).format(debt) + " ₽" })}</span>}
                        {x?.movedFrom && <span className="pill grey">{t("sch.moved")}</span>}
                      </div>
                    )}
                    {l.note && <div className="tl-note" title={l.note}><Icon name="msg" size="sm" />{l.note}</div>}
                  </div>
                  <div className="tl-act">
                    <Link href={`/class/${l.id}`} className={`btn sm ${role === "TEACHER" || soon || live ? "primary" : "secondary"}`}><Icon name="class" size="sm" />{role === "TEACHER" ? t("dash.openClass") : t("cls.enter")}</Link>
                    {currentHomework && <Link href={`/class/${l.id}?tab=homework`} className={`btn sm ${currentHomework.reminder ? "tinted" : "secondary"}`}><Icon name="home" size="sm" /><span className="min-w-0 whitespace-normal">{currentHomework.label}</span></Link>}
                    {role === "TEACHER" && <LessonCall lessonId={l.id} href={callLink} canAdd={l.status === "PLANNED"} />}
                    <div className="tl-quick">
                    {/* урок прошёл — вместо «Перенести / Отменить» комментарий после урока (уйдёт в заметку к следующему) */}
                    {role === "TEACHER" && end <= now.getTime() && <AfterNote id={l.id} next={nextOf.get(l.id) ?? null} />}
                    {role === "TEACHER" && end > now.getTime() && <LessonQuick l={{
                      id: l.id, day: 0, startMin: 0, dur: l.durationMin, status: l.status, who, isTrial: l.isTrial, isGroup: !!l.slotId, note: l.note,
                      date: isoDay(l.startsAt, tz), start: hhmm(l.startsAt, tz), end: hhmm(new Date(end), tz), weekly: !!l.seriesId, past: end <= now.getTime(),
                      studentId: l.studentId, charged: l.charged, moved: !!l.movedFrom, price: l.price ?? 0, hw: null,
                    }} />}
                    </div>
                    {role === "TEACHER" && l.status === "DONE" && l.studentId && <Link href={`/teacher/lesson-analysis/${l.id}`} className="btn secondary sm">
                      <Icon name="spark" size="sm" />{t("today.analysis")}
                    </Link>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-7 mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="m-0">{windowStart === todayIso ? t("dash.week") : weekRange(windowStart, tz, loc)}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {role === "TEACHER" && <nav className="weeknav" aria-label={t("dash.week")}>
              <Link href={dayHref(addDaysIso(windowStart, -1))} scroll={false} aria-label={t("sch.prev")}><Icon name="chevl" size="sm" /></Link>
              {windowStart < todayIso && <Link href={dayHref(addDaysIso(windowStart, 7))} scroll={false} aria-label={t("sch.next")}><Icon name="right" size="sm" /></Link>}
            </nav>}
            {windowStart < todayIso && <Link href={dayHref(todayIso)} scroll={false} className="btn secondary sm">{t("dash.today")}</Link>}
            <Link href={`${scheduleHref}?w=${mondayOf(sel)}`} className="alink small whitespace-nowrap">{t("nav.schedule")} →</Link>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 max-[760px]:flex max-[760px]:overflow-x-auto">
          {days.map((d) => (
            <Link key={d.iso} href={dayHref(d.iso)} scroll={false} aria-current={d.iso === sel ? "true" : undefined} className={`daytile ${d.iso === sel ? "on" : ""}`}>
              <span className={`text-[12px] ${d.iso === sel ? "font-semibold" : "text-text3"}`}>{d.iso === todayIso ? t("dash.today") : d.label}</span>
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
      {/* под «Что нового» — события учеников: дни рождения, вехи, активность, свои события */}
      {moments && <MomentsCard moments={moments} students={momentStudents} />}
    </div>
  );
}
