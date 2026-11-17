import { packEndsAt } from "@/lib/teacher/pack";
import { InvoiceEdit } from "@/components/finance/FinanceParts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { DeleteStudent, FeedbackForm, PaymentCard, PrivateNote, ProfileActions, TgAsk } from "@/components/teacher/ProfileParts";
import { InlineAbout, InlineContacts, type InlineData } from "@/components/teacher/InlineProfile";
import { LinkMaker, ShareLink } from "@/components/teacher/InviteForm";
import { accessLinkAction, renewInviteAction } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { buildMessage, initials, inviteUrl } from "@/lib/invite";
import { GOALS, SINCE, SKILLS } from "@/lib/onboarding";
import { earnedOf, rub, syncSchedule } from "@/lib/teacher/data";
import { addDaysIso, hhmm, isoDay, TIMEZONES } from "@/lib/time";
import { RoadmapEditor, SkillBars } from "@/components/roadmap/RoadmapEditor";
import { editorData, progressData } from "@/lib/roadmap/progress";
import { SKILL_COLOR, SKILL_NAME, SKILLS as RM_SKILLS, txt } from "@/lib/roadmap/cefr";

export const metadata = { title: "Анкета ученика" };

const TABS = ["profile", "progress", "roadmap", "feedback", "history"] as const;

type Form = { phone?: string; birthday?: string | null; goals?: string[]; otherGoal?: string; about?: string; since?: string; easy?: string[]; hard?: string[]; problem?: string; filledAt?: string };

export default async function StudentProfile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const { id } = await params;
  const tab = (TABS as readonly string[]).includes((await searchParams).tab ?? "") ? (await searchParams).tab! : "profile";
  await syncSchedule(me.id);

  const s = await db.student.findUnique({
    where: { id },
    include: {
      packs: { orderBy: { startsAt: "desc" }, take: 1 },
      invoices: { orderBy: { createdAt: "desc" } },
      invites: { orderBy: { createdAt: "desc" }, take: 1 },
      lessons: { orderBy: { startsAt: "desc" } },
    },
  });
  if (!s || s.teacherId !== me.id) notFound();
  // подключён ли Telegram-бот: у ученика — после входа на платформу и нажатия «Подключить Telegram», у плательщика — по ссылке из оплаты
  const tgUser = s.userId ? await db.user.findUnique({ where: { id: s.userId }, select: { telegramChatId: true, lastSeenAt: true, timezone: true } }) : null;
  // «был(а) в сети»: последнее действие ученика — учёт активности, а до него (и для давних визитов) — вход, ответы в заданиях,
  // сообщения, тест, прочитанные уведомления
  const lastSeen = s.userId ? await (async () => {
    const uid = s.userId!;
    const [ses, ans, msg, pl, nt] = await Promise.all([
      db.session.findFirst({ where: { userId: uid }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.answer.findFirst({ where: { studentId: s.id }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      db.message.findFirst({ where: { senderId: uid }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.placementAttempt.findFirst({ where: { studentId: s.id, status: { not: "new" } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      db.notification.findFirst({ where: { userId: uid, readAt: { not: null } }, orderBy: { readAt: "desc" }, select: { readAt: true } }),
    ]);
    const all = [tgUser?.lastSeenAt, ses?.createdAt, ans?.updatedAt, msg?.createdAt, pl?.updatedAt, nt?.readAt].filter(Boolean) as Date[];
    return all.length ? new Date(Math.max(...all.map((d) => d.getTime()))) : null;
  })() : null;
  // активность ученика: «был(а) в сети…» и активные минуты за последние 7 дней (только действия, не фоновая вкладка)
  const days7 = Array.from({ length: 7 }, (_, i) => addDaysIso(isoDay(new Date(), me.timezone), i - 6));
  const act = s.userId ? await db.activityDay.findMany({ where: { userId: s.userId, day: { in: days7 } } }) : [];
  const actBy = new Map(act.map((a) => [a.day, a]));
  const seenAgo = (d: Date) => {
    const m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 3) return t("prof.seenNow");
    if (m < 60) return t("prof.seenMin", { n: m });
    if (m < 24 * 60 && isoDay(d, me.timezone) === isoDay(new Date(), me.timezone)) return t("prof.seenH", { n: Math.round(m / 60) });
    if (isoDay(d, me.timezone) === addDaysIso(isoDay(new Date(), me.timezone), -1)) return t("prof.seenYesterday", { t: hhmm(d, me.timezone) });
    return t("prof.seenDate", { d: d.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short", timeZone: me.timezone }) });
  };
  const fmtMin = (n: number) => (n >= 60 ? t("prof.hMin", { h: Math.floor(n / 60), m: n % 60 }) : t("prof.min", { n }));
  // последний пройденный тест — кнопкой в шапке анкеты, чтобы не искать в «Курсах»
  const lastTest = await db.placementAttempt.findFirst({ where: { studentId: s.id, status: { in: ["submitted", "reviewed"] } }, orderBy: { submittedAt: "desc" }, select: { id: true, status: true, level: true } });

  const tz = me.timezone;
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const form = (s.form ?? {}) as Form;
  const fullName = [s.name, s.lastName].filter(Boolean).join(" ");
  const now = new Date();
  const dateFmt = (d: Date, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) => d.toLocaleDateString(loc, { ...o, timeZone: tz });
  const tr = (list: [string, string][], v: string) => (lang === "en" ? (list.find((x) => x[0] === v)?.[1] ?? v) : v);

  const held = s.lessons.filter((l) => l.status === "DONE");
  const next = [...s.lessons].reverse().find((l) => l.status === "PLANNED" && l.startsAt > now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const earnedMonth = s.lessons.filter((l) => l.startsAt >= monthStart).reduce((a, l) => a + earnedOf(l), 0);
  const earnedTotal = s.lessons.reduce((a, l) => a + earnedOf(l), 0);
  const pastLessons = s.lessons.filter((l) => l.startsAt <= now);
  const cancelled = pastLessons.filter((l) => l.status === "CANCELLED").length;
  const since = s.startedAt ?? s.createdAt;
  const months = Math.max(0, Math.floor((now.getTime() - since.getTime()) / (30.44 * 864e5)));
  const inv = s.invites[0];
  const meName = [me.name, me.lastName].filter(Boolean).join(" ");
  const inviteValid = s.status === "INVITED" && inv && !inv.usedAt && inv.expiresAt > now;

  const tabLabel: Record<string, string> = {
    profile: t("prof.tab.profile"), progress: t("nav.progress"), roadmap: t("prof.tab.roadmap"), feedback: t("prof.tab.feedback"), history: t("prof.tab.history"),
  };
  const st: Record<string, [string, string]> = {
    PLANNED: ["blue", t("sch.st.planned")], DONE: ["green", t("sch.st.done")], MISSED: ["red", t("sch.st.missed")], CANCELLED: ["orange", t("sch.st.cancelled")],
  };
  const val = (v?: string | null) => v || "—";
  const courses = await db.course.findMany({ where: { teacherId: me.id }, orderBy: { order: "asc" }, select: { id: true, title: true } });
  const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
  const inline: InlineData = {
    id: s.id, email: s.email ?? "", phone: form.phone ?? "", telegram: s.telegram ?? "", vk: (form as { vk?: string }).vk ?? "", timezone: s.timezone, callLink: s.callLink ?? "",
    courseId: s.courseId ?? courses.find((c) => c.title.trim().toLowerCase() === (s.course ?? "").trim().toLowerCase())?.id ?? "", courseText: s.course ?? "", level: s.level ?? "", interests: s.interests ?? "",
    birthday: ymd(s.birthday) || (form.birthday ?? ""), examGoal: s.examGoal ?? "", startedAt: ymd(s.startedAt ?? s.createdAt), source: s.source ?? "",
  };

  return (
    <div className="page">
      <Link href="/teacher/students" className="mb-4 inline-flex items-center gap-1 text-[14px] font-semibold text-accent"><Icon name="chevl" size="sm" />{t("nav.students")}</Link>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <span className="avatar" style={{ width: 64, height: 64, fontSize: 22 }}>{initials(s.name, s.lastName)}</span>
        <div className="grow min-w-[200px] flex-1">
          <h1>{fullName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-text2">
            {s.course && <span>{s.course}</span>}
            {s.status === "INVITED" && <span className="pill orange">{t("prof.invited")}</span>}
            {s.status === "ARCHIVED" && <span className="pill grey">{t("stu.archived")}</span>}
            {/* статус: приглашён и ещё не заходил / был в сети — как в мессенджерах */}
            {!s.userId ? <span className="pill orange" title={t("prof.invitedHint")}>{s.invites[0] ? t("prof.invitedOn", { d: dateFmt(s.invites[0].createdAt, { day: "numeric", month: "short" }) }) : t("prof.notOnPlatform")}</span>
              : <span className={`pill ${lastSeen && Date.now() - lastSeen.getTime() < 3 * 60000 ? "green" : "grey"}`}>{lastSeen ? seenAgo(lastSeen) : t("prof.registered")}</span>}
            {tgUser?.telegramChatId || !s.userId ? <span className={`pill ${tgUser?.telegramChatId ? "green" : "grey"}`} title={t("prof.tgHint")}><Icon name="telegram" size="sm" />{t(tgUser?.telegramChatId ? "prof.tgOn" : "prof.tgOff")}</span> : <TgAsk id={s.id} />}
            {lastTest && <Link href={`/teacher/placement/${lastTest.id}`} className={`pill ${lastTest.status === "submitted" ? "orange" : "violet"}`}><Icon name="target" size="sm" />{lastTest.status === "submitted" ? t("prof.testToReview") : `${t("prof.testResult")}${lastTest.level ? ` · ${lastTest.level}` : ""}`}</Link>}
            {(s.payerName || s.payerChatId) && <span className={`pill ${s.payerChatId ? "green" : "grey"}`}><Icon name="telegram" size="sm" />{t(s.payerChatId ? "prof.payerTgOn" : "prof.payerTgOff")}</span>}
          </div>
        </div>
        <ProfileActions
          p={{
            id: s.id, name: s.name, lastName: s.lastName ?? "", email: s.email ?? "", phone: form.phone ?? "", telegram: s.telegram ?? "",
            timezone: s.timezone, callLink: s.callLink ?? "", course: s.course ?? "", level: s.level ?? "", interests: s.interests ?? "",
            examGoal: s.examGoal ?? "", source: s.source ?? "", birthday: s.birthday ? s.birthday.toISOString().slice(0, 10) : (form.birthday ?? ""),
            startedAt: s.startedAt ? s.startedAt.toISOString().slice(0, 10) : "", archived: s.status === "ARCHIVED",
          }}
        />
      </div>

      {s.status === "INVITED" && !s.userId && (
        <div className="alert ok mb-5">
          <p className="mt-0 mb-3">{inviteValid ? t("prof.inviteWaiting") : t("inviteT.expired")}</p>
          {inviteValid
            ? <ShareLink link={inviteUrl(inv.token)} msg={await buildMessage(me.id, "invite", lang, { name: s.name, teacher: meName, link: inviteUrl(inv.token) })} kind="invite" vars={{ name: s.name, teacher: meName }} />
            : <LinkMaker label={t("inviteT.renew")} make={renewInviteAction.bind(null, s.id)} kind="invite" vars={{ name: s.name, teacher: meName }} />}
        </div>
      )}
      {s.userId && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <LinkMaker label={t("inviteT.access")} hint={t("inviteT.accessHint")} icon="lock" make={accessLinkAction.bind(null, s.id)} kind="access" vars={{ name: s.name, teacher: meName }} />
        </div>
      )}

      <nav className="tabsbar lg mb-6">
        {TABS.map((k) => (
          <Link key={k} href={`/teacher/students/${s.id}?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{tabLabel[k]}</Link>
        ))}
      </nav>

      {tab === "profile" && (
        <div className="profgrid">
          <div>
            <InlineContacts d={inline} />
            <InlineAbout d={inline} courses={courses} />
            {form.filledAt && (
              <section className="card sm">
                <p className="cardtitle">{t("prof.startForm")} · {dateFmt(new Date(form.filledAt), { day: "numeric", month: "long" })}</p>
                <div className="goalq">
                  <span className="small muted">{t("prof.goalBy")}</span>
                  <b>{[...(form.goals ?? []).map((g) => tr(GOALS, g)), form.otherGoal].filter(Boolean).join("; ") || "—"}</b>
                </div>
                <dl className="kv">
                  <dt>{t("prof.since")}</dt><dd>{form.since ? tr(SINCE, form.since) : "—"}</dd>
                  <dt>{t("prof.easy")}</dt><dd>{(form.easy ?? []).map((x) => tr(SKILLS, x)).join(", ") || "—"}</dd>
                  <dt>{t("prof.hard")}</dt><dd>{(form.hard ?? []).map((x) => tr(SKILLS, x)).join(", ") || "—"}</dd>
                  <dt>{t("prof.problem")}</dt><dd>{val(form.problem)}</dd>
                  <dt>{t("prof.aboutSelf")}</dt><dd>{val(form.about)}</dd>
                </dl>
              </section>
            )}
            <PrivateNote id={s.id} initial={s.privateNote ?? ""} />
          </div>
          <div>
            <PaymentCard
              earnedMonth={rub(earnedMonth, lang)}
              p={{
                id: s.id, payType: s.payType, billRule: s.billRule ?? "", remindEveryDays: s.remindEveryDays, price: s.price,
                packPrices: (s.packPrices as { n: number; price: number }[]) ?? [], payerName: s.payerName ?? "", payerContact: s.payerContact ?? "",
                pack: s.packs[0] ? {
                  left: s.packs[0].lessonsLeft, total: s.packs[0].lessonsTotal, price: s.packs[0].price, since: dateFmt(s.packs[0].startsAt, { day: "numeric", month: "short" }),
                  ends: await packEndsAt(s.id, s.packs[0].lessonsLeft).then((d) => (d ? dateFmt(d, { day: "numeric", month: "short" }) : null)),
                  // списанные уроки этого абонемента — последние по дате
                  used: s.lessons.filter((l) => l.deductedAt && l.deductedAt.getTime() >= s.packs[0].startsAt.getTime() - 60000).slice(0, Math.max(0, s.packs[0].lessonsTotal - s.packs[0].lessonsLeft))
                    .map((l) => ({ id: l.id, date: dateFmt(l.startsAt, { day: "numeric", month: "short", weekday: "short" }), missed: l.status === "MISSED" })),
                } : null,
                today: isoDay(now, tz),
                payerLinked: !!s.payerChatId, studentName: s.name, teacherName: meName,
              }}
            />
            {s.userId && (
              <section className="card sm">
                <div className="mb-2 flex items-center justify-between"><p className="cardtitle m-0">{t("prof.activity")}</p><span className="small muted">{lastSeen ? seenAgo(lastSeen) : ""}</span></div>
                <div className="flex items-baseline gap-2"><b className="text-[22px]">{fmtMin(act.reduce((a, x) => a + x.minutes, 0))}</b><span className="small muted">{t("prof.act7")}</span></div>
                <div className="actbars" aria-label={t("prof.activity")}>
                  {days7.map((d) => {
                    const a = actBy.get(d), max = Math.max(30, ...act.map((x) => x.minutes));
                    const dow = new Date(`${d}T12:00:00Z`).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { weekday: "short", timeZone: "UTC" });
                    return (
                      <div key={d} className="actday" title={a ? `${fmtMin(a.minutes)}${a.classMinutes ? ` · ${t("prof.actClass", { m: fmtMin(a.classMinutes) })}` : ""}` : t("prof.actNone")}>
                        <span className="actbar"><i style={{ height: `${a ? Math.max(6, (a.minutes / max) * 100) : 0}%` }} /><i className="cls" style={{ height: `${a ? (a.classMinutes / max) * 100 : 0}%` }} /></span>
                        <small>{dow.replace(".", "")}</small>
                      </div>
                    );
                  })}
                </div>
                <p className="hint mb-0 mt-2">{t("prof.actHint")}</p>
              </section>
            )}
            <section className="card sm">
              <p className="cardtitle">{t("prof.nextLesson")}</p>
              {next ? (
                <>
                  <b className="block text-[17px]">{dateFmt(next.startsAt, { weekday: "long", day: "numeric", month: "long" })}, {hhmm(next.startsAt, tz)}</b>
                  <span className="small muted">{next.durationMin} {t("dash.min")}{next.seriesId ? ` · ${t("sch.everyWeek")}` : ""}</span>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link className="btn primary sm" href={`/class/${next.id}`}><Icon name="class" size="sm" />{t("dash.openClass")}</Link>
                    <Link className="btn secondary sm" href={`/teacher/schedule?w=${isoDay(next.startsAt, tz)}`}><Icon name="cal" size="sm" />{t("nav.schedule")}</Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="hint mt-0">{t("prof.noNext")}</p>
                  <Link className="btn primary sm" href={`/teacher/schedule?new=1&student=${s.id}${held.length === 0 ? "&trial=1" : ""}`}><Icon name="plus" size="sm" />{held.length === 0 ? t("inviteT.trial") : t("sch.new")}</Link>
                </>
              )}
            </section>
            <section className="card sm">
              <div className="mb-3 flex items-center justify-between"><p className="cardtitle m-0">{t("prof.together")}</p><span className="pill grey">{t("prof.since2", { d: dateFmt(since, { day: "numeric", month: "short", year: "numeric" }) })}</span></div>
              <div className="grid-2">
                <div className="statt"><span className="si" style={{ background: "var(--accent)" }}><Icon name="cal" /></span><div><b>{held.length}</b><span>{t("prof.lessonsHeld")}</span></div></div>
                <div className="statt"><span className="si" style={{ background: "#5E5CE6" }}><Icon name="clock" /></span><div><b>{months}</b><span>{t("prof.monthsTogether")}</span></div></div>
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === "history" && (
        <>
          <div className="grid-3 mb-4">
            <div className="statt" style={{ background: "var(--surface)" }}><span className="si" style={{ background: "var(--accent)" }}><Icon name="cal" /></span><div><b>{held.length}</b><span>{t("prof.lessonsHeld")}</span></div></div>
            <div className="statt" style={{ background: "var(--surface)" }}><span className="si" style={{ background: "var(--ok)" }}><Icon name="coin" /></span><div><b>{rub(earnedTotal, lang)}</b><span>{t("prof.earnedTotal")}</span></div></div>
            <div className="statt" style={{ background: "var(--surface)" }}><span className="si" style={{ background: "var(--warn)" }}><Icon name="calx" /></span><div><b>{pastLessons.length ? Math.round((cancelled / pastLessons.length) * 100) : 0}%</b><span>{t("prof.cancelledPct")}</span></div></div>
          </div>
          <div className="profgrid">
            <section className="card sm hist">
              <p className="cardtitle">{t("prof.lessonsList")}</p>
              {s.lessons.length === 0 ? <p className="hint m-0">{t("prof.noLessons")}</p> : (
                <div>
                  {[
                    ...s.lessons.filter((l) => l.startsAt > now).slice(-3).map((l) => ({ l, up: true })),
                    ...pastLessons.slice(0, 200).map((l) => ({ l, up: false })),
                  ].map(({ l, up }, i, arr) => (
                    <div key={l.id} className={`row ${up ? "opacity-80" : ""} ${!up && i > 0 && arr[i - 1].up ? "histsep" : ""}`}>
                      <b className="min-w-[96px]">{dateFmt(l.startsAt, { weekday: "short", day: "numeric", month: "short", ...(isoDay(l.startsAt, tz).slice(0, 4) !== isoDay(now, tz).slice(0, 4) ? { year: "numeric" } : {}) }).replace(".", "")}</b>
                      <span className="min-w-[44px] text-text2" style={{ fontVariantNumeric: "tabular-nums" }}>{hhmm(l.startsAt, tz)}</span>
                      <span className={`pill ${st[l.status][0]}`}>{st[l.status][1]}</span>
                      <span className="grow small muted">{l.isTrial ? t("sch.trial") : l.note ?? ""}</span>
                      <Link href={`/teacher/schedule?w=${isoDay(l.startsAt, tz)}`} className="alink small">{t("prof.open")}</Link>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="card sm hist">
              <p className="cardtitle">{t("prof.payments")}</p>
              {s.invoices.length === 0 ? <p className="hint m-0">{t("prof.noPayments")}</p> : s.invoices.map((iv) => (
                <div key={iv.id} className="row">
                  <b className="min-w-[60px]">{dateFmt(iv.createdAt, { day: "numeric", month: "short" })}</b>
                  <span className="grow">{iv.period ?? ""}</span>
                  <b>{rub(iv.amount, lang)}</b>
                  <span className={`pill ${iv.status === "PAID" ? "green" : iv.status === "CANCELLED" ? "grey" : "orange"}`}>{t(`inv.${iv.status}` as "inv.PAID")}</span>
                  {iv.status !== "CANCELLED" && <InvoiceEdit id={iv.id} />}
                </div>
              ))}
            </section>
          </div>
        </>
      )}

      {tab === "roadmap" && <RoadmapEditor d={await editorData(s.id, me.id, tz, lang)} />}
      {tab === "progress" && <ProgressTab studentId={s.id} tz={tz} lang={lang} t={t} topics={held.filter((l) => l.templateId).length} />}
      {tab === "feedback" && <FeedbackTab studentId={s.id} tz={tz} lang={lang} t={t} />}

      <div className="mt-8 border-t border-sep pt-4">
        <DeleteStudent id={s.id} name={fullName} />
      </div>
    </div>
  );
}

type TT = Awaited<ReturnType<typeof getT>>["t"];

async function ProgressTab({ studentId, tz, lang, t, topics }: { studentId: string; tz: string; lang: "ru" | "en"; t: TT; topics: number }) {
  const p = await progressData(studentId, tz);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const mx = Math.max(1, ...p.months.map(([, h]) => h));
  const last = p.tests[p.tests.length - 1], prev = p.tests[p.tests.length - 2];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card">
        <h3 className="mt-0">{t("pr.hours")}</h3>
        <div className="bars6">{p.months.map(([k, h]) => (
          <div key={k} className="barcol"><span className="small">{Math.round(h)}</span><span className="bar" style={{ height: `${(h / mx) * 120 + 4}px` }} /><span className="small muted">{new Date(`${k}-15`).toLocaleDateString(loc, { month: "short" })}</span></div>
        ))}</div>
        <p className="hint mb-0">{t("pr.topics", { n: topics })}</p>
      </section>
      <section className="card">
        <h3 className="mt-0">{t("pr.skills")}</h3>
        {last ? <>
          <div className="mb-3 small muted">{last.level} · {last.at.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz })}</div>
          <SkillBars skills={last.skills} prev={prev?.skills} />
        </> : <p className="hint m-0">{t("rm.noTest")}</p>}
      </section>
      {p.tests.length > 1 && (
        <section className="card lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0">{t("pr.dynamics")}</h3>
            <span className="small muted">{p.tests.map((x) => `${x.level ?? ""} ${x.at.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: tz })}`.trim()).join("  →  ")}</span>
          </div>
          <div className="skilldyn">
            {RM_SKILLS.filter((k) => p.tests.some((x) => x.skills[k] !== undefined)).map((k) => (
              <div key={k} className="sdcol"><div className="sdbars">{p.tests.map((x, i) => <span key={i} className="sdbar" title={`${x.at.toLocaleDateString(loc, { timeZone: tz })}: ${x.skills[k] ?? "—"}%`}><em>{x.skills[k] ?? "—"}</em><i style={{ height: `${(x.skills[k] ?? 0) * 1.2}px`, background: SKILL_COLOR[k], opacity: 0.45 + (0.55 * (i + 1)) / p.tests.length }} /></span>)}</div><span className="small">{txt(SKILL_NAME[k], lang)}</span></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

async function FeedbackTab({ studentId, tz, lang, t }: { studentId: string; tz: string; lang: "ru" | "en"; t: TT }) {
  const list = await db.feedback.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, include: { lessonInstance: { include: { template: true } } } });
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <>
    <FeedbackForm studentId={studentId} />
    <section className="list">
      {list.length === 0 && <p className="hint p-5 m-0">{t("pr.noFb")}</p>}
      {list.map((f) => (
        <div key={f.id} className="qrow"><div className="grow">
          <div className="flex flex-wrap justify-between gap-2"><span className="small muted">{f.lessonInstance?.template?.title ?? f.period ?? ""}</span><span className="small text-text3">{f.createdAt.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz })}</span></div>
          <p className="mb-0 mt-1 whitespace-pre-line">{f.text}</p>
        </div></div>
      ))}
    </section>
    </>
  );
}
