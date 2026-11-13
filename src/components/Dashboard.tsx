import Link from "next/link";
import { Clock } from "./Clock";
import { Icon } from "./Icon";
import { NotificationList } from "./NotificationList";
import { HideSteps } from "./teacher/HideSteps";
import { getT } from "@/lib/i18n/server";
import { greetingKey, hourIn } from "@/lib/greeting";
import { db } from "@/lib/db";
import { addDaysIso, dayStart, hhmm, isoDay, mondayOf } from "@/lib/time";
import { lessonInclude, lessonWho, oneSlot, syncSchedule } from "@/lib/teacher/data";
import { initials } from "@/lib/invite";
import { homeworkFor, type HwState } from "@/lib/homework";
import type { User } from "@prisma/client";

/** Главный экран «Обновления»: приветствие, часы, «Сегодня», неделя, «Что нового». */
export async function Dashboard({ user, role, day }: { user: User; role: "TEACHER" | "STUDENT"; day?: string }) {
  const { t, lang } = await getT();
  const tz = user.timezone;
  const now = new Date();
  const todayIso = isoDay(now, tz);
  const from = dayStart(todayIso, tz);
  const to = dayStart(addDaysIso(todayIso, 7), tz);
  if (role === "TEACHER") await syncSchedule(user.id);

  const where = role === "TEACHER" ? { teacherId: user.id } : { student: { userId: user.id } };
  const [lessonsAll, notifications, hws] = await Promise.all([
    db.lessonInstance.findMany({ where: { ...where, startsAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, include: lessonInclude, orderBy: { startsAt: "asc" } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    role === "TEACHER" ? homeworkFor({ teacherId: user.id }) : Promise.resolve([]),
  ]);
  const lessons = role === "TEACHER" ? oneSlot(lessonsAll) : lessonsAll; // групповое занятие у учителя — одной строкой
  // домашка к уроку = домашка с предыдущего занятия этого ученика
  const hwBefore = (studentId: string | null, at: Date) => (studentId ? hws.find((h) => h.lesson.studentId === studentId && h.lesson.startsAt < at) ?? null : null);
  const hwPill = { review: ["orange", "hwT.review"], notdone: ["red", "hwT.notdone"], checked: ["green", "hwT.checked"] } as const satisfies Record<HwState, readonly [string, string]>;

  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  // выбранный в полосе «Эта неделя» день (по умолчанию — сегодня)
  const sel = day && day >= todayIso && day < addDaysIso(todayIso, 7) ? day : todayIso;
  const isToday = sel === todayIso;
  const todayLessons = lessons.filter((l) => isoDay(l.startsAt, tz) === sel);
  // подробности уроков выбранного дня: материал, абонемент, долг, первый урок, день рождения
  const extra = new Map((await db.lessonInstance.findMany({
    where: { id: { in: todayLessons.map((l) => l.id) } },
    select: {
      id: true, movedFrom: true,
      template: { select: { title: true, subtitle: true, unit: { select: { title: true, course: { select: { title: true } } } } } },
      student: { select: { payType: true, birthday: true, packs: { orderBy: { startsAt: "desc" }, take: 1, select: { lessonsLeft: true, lessonsTotal: true } }, invoices: { where: { status: { in: ["SENT", "PROOF_SENT"] } }, select: { amount: true } }, _count: { select: { lessons: { where: { status: "DONE" } } } } } },
    },
  })).map((x) => [x.id, x]));
  const selTitle = isToday ? t("dash.today") : ((x) => x.charAt(0).toUpperCase() + x.slice(1))(new Date(dayStart(sel, tz).getTime() + 12 * 3600e3).toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: tz }));
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(todayIso, i);
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
  if (role === "TEACHER") {
    const [courses, students, anyLesson, prof] = await Promise.all([
      db.course.count({ where: { teacherId: user.id } }),
      db.student.count({ where: { teacherId: user.id } }),
      db.lessonInstance.count({ where: { teacherId: user.id } }),
      db.teacherProfile.findUnique({ where: { userId: user.id }, select: { callLink: true, settings: true } }),
    ]);
    const pay = !!(prof?.settings as { payDetails?: string } | null)?.payDetails;
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

  return (
    <div className="page">
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
              const live = start <= now.getTime() && now.getTime() < end;
              const inMin = Math.round((start - now.getTime()) / 60000);
              const soon = inMin > 0 && inMin <= 60;
              const who = role === "TEACHER" ? lessonWho(l) : t("dash.lesson");
              const x = extra.get(l.id);
              const st = l.slotId ? null : x?.student; // у группы — без абонемента, долга и дня рождения одного ученика
              const pack = st?.payType === "PACK" ? st.packs[0] : null;
              const debt = st?.invoices.reduce((a, i) => a + i.amount, 0) ?? 0;
              const hw = l.slotId ? null : hwBefore(l.studentId, l.startsAt);
              const bday = st?.birthday && isoDay(st.birthday, "UTC").slice(5) === sel.slice(5);
              const first = !!st && !l.isTrial && st._count.lessons === 0;
              return (
                <div key={l.id} className={`tl ${live ? "now" : soon ? "soon" : ""}`}>
                  <div className="tl-time">
                    <b className={live ? "text-ok" : ""}>{hhmm(l.startsAt, tz)}</b>
                    <span>{hhmm(new Date(end), tz)}</span>
                    {soon && <em className="text-accent">{t("today.startsIn", { n: inMin })}</em>}
                    {live && <em className="text-ok">{t("today.live")}</em>}
                  </div>
                  <div className="tl-main">
                    <div className="tl-who">
                      <span className="avatar">{l.group ? <Icon name="group" size="sm" /> : initials(...(who.split(" ") as [string, string]))}</span>
                      {role === "TEACHER" && l.studentId && !l.slotId ? <Link href={`/teacher/students/${l.studentId}`} className="hover:text-accent">{who}</Link> : <span>{who}</span>}
                      {l.isTrial && <span className="pill violet">{t("sch.trial")}</span>}
                      {first && <span className="pill violet">{t("today.first")}</span>}
                      {bday && <span className="pill orange">🎂 {t("today.bday")}</span>}
                    </div>
                    <div className="tl-what">
                      {x?.template ? <><b>{x.template.title}</b>{x.template.subtitle ? ` · ${x.template.subtitle}` : ""}<span className="text-text3"> — {x.template.unit.course.title}, {x.template.unit.title}</span></> : <span className="text-text3">{t("today.noMaterial")}</span>}
                    </div>
                    {(hw || pack || debt > 0 || x?.movedFrom) && (
                      <div className="tl-tags">
                        {hw && <Link href={`/class/${hw.lesson.id}?tab=homework`} className={`pill ${hwPill[hw.state][0]}`} title={`${hw.title} · ${hw.done}/${hw.total}`}>{t("nav.homework")}: {t(hwPill[hw.state][1]).toLowerCase()}</Link>}
                        {pack && <span className={`pill ${pack.lessonsLeft <= 1 ? "orange" : "grey"}`}>{t("prof.left", { n: pack.lessonsLeft, total: pack.lessonsTotal })}</span>}
                        {debt > 0 && <span className="pill red">{t("today.debt", { sum: new Intl.NumberFormat(loc).format(debt) + " ₽" })}</span>}
                        {x?.movedFrom && <span className="pill grey">{t("sch.moved")}</span>}
                      </div>
                    )}
                    {l.note && <div className="tl-note" title={l.note}><Icon name="msg" size="sm" />{l.note}</div>}
                  </div>
                  <div className="tl-act">
                    <Link href={`/class/${l.id}`} className={`btn sm ${soon || live ? "primary" : "secondary"}`}><Icon name="class" size="sm" />{role === "TEACHER" ? t("dash.openClass") : t("cls.enter")}</Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-7 mb-3 flex items-baseline justify-between gap-3">
          <h3 className="m-0">{t("dash.week")}</h3>
          <Link href={`${scheduleHref}?w=${mondayOf(sel)}`} className="alink small whitespace-nowrap">{t("nav.schedule")} →</Link>
        </div>
        <div className="grid grid-cols-7 gap-1 max-[760px]:flex max-[760px]:overflow-x-auto">
          {days.map((d, i) => (
            <Link key={d.iso} href={i === 0 ? "?" : `?d=${d.iso}`} scroll={false} aria-current={d.iso === sel ? "true" : undefined} className={`daytile ${d.iso === sel ? "on" : ""}`}>
              <span className={`text-[12px] ${d.iso === sel ? "font-semibold" : "text-text3"}`}>{i === 0 ? t("dash.today") : d.label}</span>
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
    </div>
  );
}
