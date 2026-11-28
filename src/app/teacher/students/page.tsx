import { teacherVocabularyStats } from "@/lib/teacher/vocabulary-stats";
import { VocabularyStatsCard } from "@/components/teacher/VocabularyStatsCard";
import Link from "next/link";
import { DeleteInvite, InviteButton, StudentsGrid, type Card } from "@/components/teacher/StudentsGrid";
import { CopyLink, LinkMaker } from "@/components/teacher/InviteForm";
import { Groups } from "@/components/teacher/Groups";
import { renewInviteAction } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { initials, inviteUrl } from "@/lib/invite";
import { rub } from "@/lib/teacher/data";
import { roadmapView } from "@/lib/roadmap/progress";
import { PackTicket } from "@/components/teacher/PackTicket";
import { LessonPaidBtn } from "@/components/finance/FinanceParts";
import { packEndsAt } from "@/lib/teacher/pack";
import { hhmm, isoDay } from "@/lib/time";
import { levelLine, levelsOf } from "@/lib/teacher/levels";

export const metadata = { title: "Ученики" };

const TABS = ["profiles", "roadmaps", "payments"] as const;

export default async function Students({ searchParams }: { searchParams: Promise<{ tab?: string; invite?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const sp = await searchParams;
  const tab = sp.tab === "archive" ? "archive" : (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "profiles";

  const all = await db.student.findMany({
    where: { teacherId: me.id },
    include: { invites: { orderBy: { createdAt: "desc" }, take: 1 }, packs: { orderBy: { startsAt: "desc" }, take: 1 }, user: { select: { telegramChatId: true } }, awards: { where: { kind: "title", pinned: true, onMain: true, OR: [{ until: null }, { until: { gt: new Date() } }] }, take: 1, select: { name: true, icon: true, color: true } } },
    orderBy: [{ name: "asc" }],
  });
  const groups = await db.group.findMany({ where: { teacherId: me.id }, include: { members: true }, orderBy: { createdAt: "asc" } });
  // время группы в расписании: ближайшее занятие (и «каждую неделю», если это серия)
  const next = await Promise.all(groups.map((g) => db.lessonInstance.findFirst({ where: { groupId: g.id, status: "PLANNED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, select: { startsAt: true, seriesId: true, durationMin: true } })));
  const whenOf = (i: number) => {
    const l = next[i];
    if (!l) return null;
    const loc = lang === "ru" ? "ru-RU" : "en-GB";
    const time = l.startsAt.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: me.timezone });
    return l.seriesId
      ? `${t("grp.every")} ${l.startsAt.toLocaleDateString(loc, { weekday: "short", timeZone: me.timezone })}, ${time}`
      : `${l.startsAt.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", timeZone: me.timezone })}, ${time}`;
  };
  const active = all.filter((s) => s.status === "ACTIVE");
  const vocabulary = tab === "profiles" ? await teacherVocabularyStats(me.id) : null;
  // «Оплата»: последний счёт каждого ученика (за какие уроки, оплачен ли) и когда закончится абонемент
  const dfmt = (d: Date) => d.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short", timeZone: me.timezone });
  // урок: «12 нояб (ср, 18:00)»
  const lfmt = (d: Date) => `${dfmt(d).replace(".", "")} (${d.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { weekday: "short", timeZone: me.timezone }).replace(".", "")}, ${hhmm(d, me.timezone)})`;
  const lastInv = new Map<string, { id: string; amount: number; status: string; title: string; createdAt: Date; lessonDates: Date[] }>();
  const packEnds = new Map<string, Date | null>();
  const packUsed = new Map<string, string[]>();
  // проведённые уроки без счёта и без списания из абонемента — «Оплачено» прямо в карточке
  const unpaid = new Map<string, { id: string; startsAt: Date; amount: number; n: number; sum: number }>();
  if (tab === "payments") {
    const ul = await db.lessonInstance.findMany({ where: { teacherId: me.id, studentId: { in: active.map((s) => s.id) }, billedAt: null, deductedAt: null, startsAt: { lte: new Date() }, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] }, orderBy: { startsAt: "desc" }, select: { id: true, studentId: true, startsAt: true, price: true, isTrial: true } });
    for (const l of ul) {
      if (l.isTrial && !(l.price ?? 0)) continue;
      const amount = l.price ?? active.find((s) => s.id === l.studentId)?.price ?? 0;
      const u = unpaid.get(l.studentId!);
      if (u) { u.n++; u.sum += amount; } else unpaid.set(l.studentId!, { id: l.id, startsAt: l.startsAt, amount, n: 1, sum: amount });
    }
    const invs = await db.invoice.findMany({ where: { studentId: { in: active.map((s) => s.id) }, status: { not: "CANCELLED" }, kind: { not: "pack" } }, orderBy: { createdAt: "desc" } });
    for (const v of invs) if (!lastInv.has(v.studentId)) lastInv.set(v.studentId, { id: v.id, amount: v.amount, status: v.status, title: v.title ?? "", createdAt: v.createdAt, lessonDates: [] });
    const lids = [...lastInv.values()].flatMap((v) => invs.find((x) => x.id === v.id)!.lessonIds);
    const ls = new Map((await db.lessonInstance.findMany({ where: { id: { in: lids } }, select: { id: true, startsAt: true } })).map((l) => [l.id, l.startsAt]));
    for (const v of lastInv.values()) v.lessonDates = invs.find((x) => x.id === v.id)!.lessonIds.map((id) => ls.get(id)).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime()) as Date[];
    for (const s of active) if (s.payType === "PACK" && s.packs[0]) {
      packEnds.set(s.id, await packEndsAt(s.id, s.packs[0].lessonsLeft, s.packs[0].frozenUntil));
      const n = Math.min(4, s.packs[0].lessonsTotal - s.packs[0].lessonsLeft);
      packUsed.set(s.id, n > 0 ? (await db.lessonInstance.findMany({ where: { studentId: s.id, deductedAt: { gte: new Date(s.packs[0].startsAt.getTime() - 60000) } }, orderBy: { startsAt: "desc" }, take: n, select: { startsAt: true } })).reverse().map((l) => lfmt(l.startsAt)) : []);
    }
  }
  const invited = all.filter((s) => s.status === "INVITED");
  const archived = all.filter((s) => s.status === "ARCHIVED");
  const full = (s: { name: string; lastName: string | null }) => [s.name, s.lastName].filter(Boolean).join(" ");
  // подпись карточки: уровень сейчас → цель · курс (а не почта)
  const lv = await levelsOf(all);
  const card = (s: (typeof all)[number], i: number, sub: string, badge?: string): Card => ({
    id: s.id, name: full(s), initials: initials(s.name, s.lastName), color: i, sub, href: `/teacher/students/${s.id}`, badge, tg: !!s.user?.telegramChatId,
    avatar: s.avatar, title: s.awards[0] ?? null,
  });
  const loc = lang === "ru" ? "ru-RU" : "en-GB";

  const tabLabel: Record<string, string> = {
    profiles: t("stu.tab.profiles"), roadmaps: t("stu.tab.roadmaps"), payments: t("stu.tab.payments"),
  };

  return (
    <div className="page">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1>{t("nav.students")}</h1>
        <Link href={tab === "archive" ? "/teacher/students" : "/teacher/students?tab=archive"} className="btn secondary sm">
          {tab === "archive" ? t("stu.backToActive") : `${t("stu.archive")} (${archived.length})`}
        </Link>
      </div>

      {tab !== "archive" && <div className="mb-6"><InviteButton openInvite={sp.invite === "1"} /></div>}

      {tab !== "archive" && (
        <nav className="tabsbar mb-6">
          {TABS.map((k) => (
            <Link key={k} href={`/teacher/students?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{tabLabel[k]}</Link>
          ))}
        </nav>
      )}

      {tab === "profiles" && (
        <>
          {vocabulary && <VocabularyStatsCard stats={vocabulary} scope="active" lang={lang} timezone={me.timezone} />}
          <StudentsGrid title={t("stu.registered")} cards={active.map((s, i) => card(s, i, levelLine(lv.get(s.id)) || t("stu.noLevel")))} empty={t("inviteT.none")} />
          {/* группы: выбрать учеников галочками — и ставить группу в расписание одним занятием */}
          <Groups
            groups={groups.map((g, i) => ({ id: g.id, title: g.title, price: g.price, members: g.members.map((m) => m.studentId), level: g.level, callLink: g.callLink, info: g.info, avatar: g.avatar, when: whenOf(i) }))}
            students={[...active, ...invited].map((s, i) => ({ id: s.id, name: full(s), initials: initials(s.name, s.lastName), color: i }))}
          />
          {invited.length > 0 && (
            <section className="mt-10">
              <div className="secthead">
                <h2>{t("inviteT.invited")} <span className="secnum">{invited.length}</span></h2>
                <span className="small muted">{t("inviteT.invitedSub")}</span>
              </div>
              <div className="list card p-0 overflow-hidden">
                {invited.map((s) => {
                  const inv = s.invites[0];
                  const expired = !inv || !!inv.usedAt || inv.expiresAt < new Date();
                  return (
                    <div key={s.id} className="row wrap-phone invrow">
                      <span className="avatar lg" style={{ background: "var(--grey-bg)", color: "var(--grey-text)" }}>{initials(s.name, s.lastName)}</span>
                      <div className="grow">
                        <Link href={`/teacher/students/${s.id}`} className="t hover:text-accent">{s.name}</Link>
                        <div className={`s ${expired ? "text-bad" : ""}`}>
                          {expired ? t("inviteT.expired") : t("inviteT.expires", { d: inv.expiresAt.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: me.timezone }) })}
                        </div>
                      </div>
                      {inv && !expired ? <CopyLink link={inviteUrl(inv.token)} /> : <LinkMaker label={t("inviteT.renew")} make={renewInviteAction.bind(null, s.id)} kind="invite" vars={{ name: s.name, teacher: [me.name, me.lastName].filter(Boolean).join(" ") }} />}
                      <DeleteInvite id={s.id} name={s.name} />
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {tab === "payments" && (
        active.length === 0 ? <section className="card"><p className="hint m-0">{t("inviteT.none")}</p></section> : (
          <div className="paygrid">
            {active.map((s) => {
              const inv = lastInv.get(s.id);
              const pk = s.packs[0];
              return (
                <section key={s.id} className="card sm stpay">
                  <Link href={`/teacher/students/${s.id}`} className="flex items-center gap-3">
                    <span className="avatar">{initials(s.name, s.lastName)}</span>
                    <div className="grow min-w-0"><b className="block truncate">{full(s)}</b><span className="small muted">{s.payType === "PACK" ? t("prof.pack") : t("prof.postpaid")}{s.price ? ` · ${rub(s.price, lang)} ${t("prof.perLesson")}` : ""}</span></div>
                  </Link>
                  {/* абонемент — «билетом»; постоплата — последний счёт: за какой урок, оплачен ли */}
                  {s.payType === "PACK" && pk ? (
                    <PackTicket compact studentId={s.id} today={isoDay(new Date(), me.timezone)} pack={{ left: pk.lessonsLeft, total: pk.lessonsTotal, since: dfmt(pk.startsAt), ends: packEnds.get(s.id) ? dfmt(packEnds.get(s.id)!) : null, used: packUsed.get(s.id) }} />
                  ) : inv ? (
                    <div className="payinv">
                      <div className="grow min-w-0">
                        <b className="block">{rub(inv.amount, lang)}</b>
                        <span className="small muted">{inv.lessonDates.length ? t("pay.lastFor", { d: inv.lessonDates.map(lfmt).join(", ") }) : t("pay.lastInv", { t: inv.title, d: dfmt(inv.createdAt) })}</span>
                      </div>
                      {inv.status === "PAID" ? <span className="pill green">✓ {t("pay.paidPill")}</span>
                        : <Link href={`/teacher/finance?tab=check&c=${inv.status === "PROOF_SENT" ? "toCheck" : "waiting"}&hl=${inv.id}#inv-${inv.id}`} className="btn primary sm">{t("pay.confirm")}</Link>}
                    </div>
                  ) : !unpaid.has(s.id) && <p className="hint m-0">{s.payType === "PACK" ? t("prof.noPack") : t("pay.noInv")}</p>}
                  {unpaid.has(s.id) && ((u) => (
                    <div className="payinv">
                      <div className="grow min-w-0">
                        <b className="block">{u.amount ? rub(u.amount, lang) : "—"}</b>
                        <span className="small muted">{t("lp.lastNoInv", { d: lfmt(u.startsAt) })}{u.n > 1 ? ` · ${t("lp.moreNoInv", { n: u.n, sum: rub(u.sum, lang) })}` : ""}</span>
                      </div>
                      <LessonPaidBtn id={u.id} />
                    </div>
                  ))(unpaid.get(s.id)!)}
                </section>
              );
            })}
          </div>
        )
      )}

      {tab === "roadmaps" && (
        <div className="rmcards">
          {active.length === 0 && <section className="card"><p className="hint m-0">{t("inviteT.none")}</p></section>}
          {await Promise.all(active.map(async (s, i) => {
            const v = await roadmapView(s.id, me.timezone);
            const r = v.r;
            return (
              <Link key={s.id} href={`/teacher/students/${s.id}?tab=roadmap`} className="card rmcard">
                <div className="flex items-center gap-3"><span className={`avatar lg c${i % 6}`}>{initials(s.name, s.lastName)}</span><div className="min-w-0 grow"><b className="block truncate">{full(s)}</b><span className="small muted">{r?.builtAt ? `${r.fromLevel ?? "?"} → ${r.goal}` : t("rm.noRoadmap")}</span></div></div>
                {r?.builtAt && "achievements" in v ? (
                  <>
                    <div className="mt-3 flex items-center gap-2"><span className="stbar grow"><span style={{ width: `${v.achievements.pct}%` }} /></span><b>{v.achievements.pct}%</b></div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {!r.approvedAt ? <span className="pill orange">{t("rm.draft")}</span> : v.lateWeeks > 0 ? <span className="pill red">{t("rm.late", { n: v.lateWeeks })}</span> : v.lateWeeks < 0 ? <span className="pill green">{t("rm.ahead", { n: -v.lateWeeks })}</span> : <span className="pill green">{t("rm.onTrack")}</span>}
                      {v.checkpoints.some((c) => c.status === "assigned") && <span className="pill grey">{t("rm.testOpen")}</span>}
                    </div>
                  </>
                ) : <div className="mt-3 flex flex-wrap gap-1.5"><span className="pill grey">{t("rm.build")}</span>{v.checkpoints.some((c) => c.status === "assigned") && <span className="pill orange">{t("rm.testOpen")}</span>}</div>}
              </Link>
            );
          }))}
        </div>
      )}

      {tab === "archive" && (
        <>
          <p className="hint mt-0 mb-4">{t("stu.archiveHint")}</p>
          <StudentsGrid title={t("stu.archive")} cards={archived.map((s, i) => card(s, i, levelLine(lv.get(s.id)), t("stu.archived")))} empty={t("stu.archiveEmpty")} />
        </>
      )}
    </div>
  );
}
