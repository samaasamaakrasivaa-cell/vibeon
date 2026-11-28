import Link from "next/link";
import { Icon } from "@/components/Icon";
import { FinTiles, type FinTile } from "@/components/finance/FinTiles";
import { StudentAvatar } from "@/components/awards/Medal";
import { CheckActions, InvoiceEdit, LessonPaidBtn, PayLaterBtn, UndoPaidBtn, PayDetails, ReceiptButton, ResendLink } from "@/components/finance/FinanceParts";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { financeData, type Range } from "@/lib/billing/finance";
import { weekReport } from "@/lib/billing/weekly";
import { WeekCard } from "@/components/finance/WeekCard";
import { initials } from "@/lib/invite";
import { rub } from "@/lib/teacher/data";

export const metadata = { title: "Финансы" };
export const dynamic = "force-dynamic";

const TABS = ["updates", "income", "students", "check"] as const;

export default async function Finance({ searchParams }: { searchParams: Promise<{ tab?: string; r?: string; c?: string; hl?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "updates";
  const range: Range = sp.r === "week" || sp.r === "all" ? sp.r : "month";
  const d = await financeData(me.id, me.timezone, range);
  const week = tab === "updates" ? await weekReport(me.id, me.timezone) : null;
  const prof = await db.teacherProfile.findUnique({ where: { userId: me.id } });
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const R = (n: number) => rub(n, lang);
  const pct = (n: number) => (d.total ? Math.round((n / d.total) * 100) : 0);
  const title = range === "month" ? ((m) => m.charAt(0).toUpperCase() + m.slice(1))(new Date().toLocaleDateString(loc, { month: "long", year: "numeric", timeZone: me.timezone }).replace(/\s*г\.$/, "")) : range === "week" ? t("fin.thisWeek") : t("fin.allTime");
  const q = (p: Record<string, string>) => `?${new URLSearchParams({ tab, r: range, ...p })}`;
  const checkTab = sp.c === "toCheck" || sp.c === "auto" ? sp.c : "waiting";
  const rows = d.check[checkTab as keyof typeof d.check];
  const waitingTotal = d.check.waiting.reduce((sum, i) => sum + i.amount, d.unbilledSum);
  const waitingPackDue = d.check.waiting.filter((i) => i.kind === "pack").reduce((sum, i) => sum + i.amount, 0);
  const daysSince = d.oldestProof ? Math.floor((Date.now() - d.oldestProof.getTime()) / 864e5) : 0;
  const maxM = Math.max(1, ...d.months.flatMap((m) => [m.earned, m.received]));
  const maxS = Math.max(1, ...d.perStudent.map((p) => p.earned));
  const insightText: Record<string, (v: Record<string, string | number>) => string> = {
    cancels: (v) => t("fin.ins.cancels", v), moves: (v) => t("fin.ins.moves", v), cancelsG: (v) => t("fin.ins.cancelsG", v), movesG: (v) => t("fin.ins.movesG", v), debt: (v) => t("fin.ins.debt", { name: v.name, sum: R(Number(v.sum)) }), ending: (v) => t("fin.ins.ending", v),
  };
  // плитки «Обновлений» и их расшифровка (нажали — раскрылся список)
  const dt = (x: Date) => x.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: me.timezone }).replace(".", "");
  const dtt = (x: Date) => `${dt(x)}, ${x.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: me.timezone })}`;
  const dates = (xs: Date[]) => (xs.length > 4 ? [...xs.slice(0, 4).map(dt), t("fin.det.more", { n: xs.length - 4 })] : xs.map(dt)).join(", ");
  // «Ждём оплаты» у ученика: даты уроков (без счёта и из счетов за урок), другие счета — названием; прислал чек — пометка
  const waitSub = (r: (typeof d.waitingBy)[number]) => {
    const one = r.invoices.flatMap((i) => i.dates);
    const lessonPart = [...r.lessons, ...one].sort((a, b) => a.getTime() - b.getTime()).map(dt);
    const other = r.invoices.filter((i) => !i.dates.length).map((i) => i.title); // счёт не за уроки (абонемент) — названием
    return [lessonPart.length ? t("fin.det.lessons", { d: lessonPart.length > 4 ? [...lessonPart.slice(0, 4), t("fin.det.more", { n: lessonPart.length - 4 })].join(", ") : lessonPart.join(", ") }) : "", ...other,
      r.invoices.some((i) => i.proof) ? t("fin.det.proof") : "", r.later ? t("lp.laterTitle").toLowerCase() : ""].filter(Boolean).join(" · ");
  };
  const tiles: FinTile[] = [
    { key: "earned", icon: "coin", main: true, value: R(d.earned), label: t("fin.earned"), rows: d.perStudent.filter((p) => p.earned > 0).map((p) => ({ id: p.s.id, sid: p.s.id, avatar: p.s.avatar, title: `${p.s.name} ${p.s.lastName ?? ""}`.trim(), sub: t("fin.lessonsN", { n: p.lessons }), right: R(p.earned) })) },
    { key: "received", icon: "wallet", color: "var(--accent)", value: R(d.received), label: t("fin.received"), rows: d.receivedBy.map((r) => ({ id: r.id, sid: r.id, avatar: r.avatar, title: r.name, sub: t("fin.det.paid", { n: r.n, d: dt(r.last) }), right: R(r.sum) })) },
    { key: "waiting", icon: "hourglass", color: "var(--warn)", value: R(d.waiting), bad: d.waiting > 0, label: t("fin.waiting"), note: d.unbilledSum > 0 ? t("lp.inclNoInv", { sum: R(d.unbilledSum) }) : undefined,
      rows: d.waitingBy.map((r) => ({ id: r.id, sid: r.id, avatar: r.avatar, title: r.name, sub: waitSub(r), right: R(r.sum), tone: "bad" as const })) },
    { key: "prepaid", icon: "gift", color: "var(--violet)", value: R(d.prepaid), label: t("fin.prepaid"), rows: d.prepaidBy.map((r) => ({ id: r.id, sid: r.id, avatar: r.avatar, title: r.name, sub: t("fin.det.pack", { left: r.left, total: r.totalN }), right: R(r.sum) })) },
    { key: "cancelled", icon: "calx", color: "var(--bad)", value: `${pct(d.cancelled)}%`, label: t("fin.cancelled", { n: d.cancelled, total: d.total }), head: t("fin.det.groupOnce"),
      rows: d.cancelledList.map((l) => ({ id: l.id, group: l.group, title: l.who, sub: dtt(l.at) + (l.charged ? ` · ${t("fin.det.charged")}` : ""), right: "" })) },
    { key: "moved", icon: "move", color: "#5AC8FA", value: `${pct(d.moved)}%`, label: t("fin.moved", { n: d.moved, total: d.total }), head: t("fin.det.groupOnce"),
      rows: d.movedList.map((l) => ({ id: l.id, group: l.group, title: l.who, sub: `${dtt(l.from)} → ${l.cancelled ? t("fin.det.thenCancelled") : dtt(l.to)}` })) },
  ];
  const toPay = d.check.toCheck.length + d.unbilled.length; // как значок у «Финансы» в меню
  return (
    <div className="page">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1>{t("nav.finance")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <PayDetails initial={((prof?.settings as { payDetails?: string })?.payDetails) ?? ""} />
          <div className="seg nowrap">{(["week", "month", "all"] as const).map((r) => <Link key={r} href={q({ r })} aria-current={range === r ? "page" : undefined}>{t(`fin.r.${r}`)}</Link>)}</div>
        </div>
      </div>
      <nav className="tabsbar mb-6">
        {TABS.map((k) => <Link key={k} href={q({ tab: k })} aria-current={tab === k ? "page" : undefined}>{t(`fin.tab.${k}`)}{k === "check" && toPay > 0 && <span className="tabcnt">{toPay}</span>}</Link>)}
      </nav>

      {tab === "updates" && (
        <>
          <h2 className="mb-4">{title}</h2>
          <FinTiles tiles={tiles} />
          <WeekCard r={week} lang={lang} />
          {d.check.toCheck.length > 0 && (
            <div className="alert mt-5 flex flex-wrap items-center gap-3" style={{ background: "var(--warn-bg)", color: "var(--warn-text)" }}>
              <Icon name="alert" size="sm" /><span className="grow">{daysSince > 0 ? t("fin.notChecked", { n: daysSince }) : t("fin.toCheckNow", { n: d.check.toCheck.length })}</span>
              <Link href={q({ tab: "check", c: "toCheck" })} className="btn primary sm">{t("fin.checkNow")}</Link>
            </div>
          )}
          {d.insights.length > 0 && (
            <section className="card mt-5" style={{ background: "linear-gradient(135deg, var(--violet-bg), var(--surface))" }}>
              <div className="mb-2 flex items-center gap-1.5 font-semibold text-violet"><Icon name="spark" size="sm" />{t("fin.worth")}</div>
              {d.insights.map((x, i) => <div key={i} className="row" style={{ minHeight: 44 }}><input type="checkbox" className="check" aria-label="done" /><span>{insightText[x.kind](x.vars)}</span></div>)}
            </section>
          )}
        </>
      )}

      {tab === "income" && (
        <section className="card">
          <h2 className="mb-1">{range === "week" ? t("fin.byDay") : range === "month" ? t("fin.byWeek") : t("fin.byMonth")}</h2>
          <div className="legend mb-4"><span><i style={{ background: "var(--ok)" }} />{t("fin.earnedShort")}</span><span><i style={{ background: "var(--accent)" }} />{t("fin.receivedShort")}</span></div>
          <div className="bars">
            {d.months.map((m) => (
              <div key={m.key} className="barcol">
                <div className="barpair">
                  <i style={{ height: `${(m.earned / maxM) * 100}%`, background: "var(--ok)" }} title={R(m.earned)} />
                  <i style={{ height: `${(m.received / maxM) * 100}%`, background: "var(--accent)" }} title={R(m.received)} />
                </div>
                <b className="small">{R(m.earned)}</b>
                <span className="small muted">{m.kind === "day"
                  ? m.start.toLocaleDateString(loc, { weekday: "short", day: "numeric", timeZone: me.timezone }).replace(".", "")
                  : m.kind === "week"
                    ? `${m.key === m.endIso ? "" : `${m.start.toLocaleDateString(loc, { day: "numeric", timeZone: me.timezone })}–`}${new Date(`${m.endIso}T12:00:00Z`).toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "")}`
                    : m.start.toLocaleDateString(loc, { month: "short", ...(m.start.getUTCMonth() === 0 || m.key === d.months[0].key ? { year: "2-digit" } : {}), timeZone: me.timezone }).replace(".", "")}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "students" && (
        <section className="card">
          <h2 className="mb-4">{title}</h2>
          <div className="flex flex-col gap-2">
            {d.perStudent.map((p, i) => (
              <div key={p.s.id} className="finrow">
                <span className="fr-n small text-text3">{i + 1}</span>
                <Link href={`/teacher/students/${p.s.id}`} className="fr-name truncate font-semibold hover:text-accent">{p.s.name} {p.s.lastName}</Link>
                <span className="fr-bar hwbar"><i style={{ width: `${(p.earned / maxS) * 100}%` }} /></span>
                <b className="fr-sum text-right">{R(p.earned)}</b>
                <span className="fr-cnt text-right small muted">{t("fin.lessonsN", { n: p.lessons })}</span>
                <div className="fr-debt text-right small">
                  {p.debt > 0 && <span className="text-bad font-semibold debt-tip" tabIndex={0} data-tip={ [p.debtLessons.length ? t("fin.det.unpaidLessons", { d: p.debtLessons.map(dtt).join("; ") }) : "", ...p.debtInvoices.map((i) => (i.dates.length ? t("fin.det.invLessons", { sum: R(i.amount), d: i.dates.map(dtt).join("; ") }) : t("fin.det.invSum", { title: i.title, sum: R(i.amount) })))].filter(Boolean).join("\n")}>{t("fin.debt", { sum: R(p.debt) })}</span>}
                  {p.packDue > 0 && <span className="block text-text3">{t("fin.packDue", { sum: R(p.packDue) })}</span>}
                  {!p.debt && !p.packDue && <span className="text-text3">—</span>}
                </div>
              </div>
            ))}
            {d.perStudent.length === 0 && <p className="hint m-0">{t("inviteT.none")}</p>}
          </div>
        </section>
      )}

      {tab === "check" && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Link href={q({ c: "waiting" })} className={`chkpill ${checkTab === "waiting" ? "on" : ""}`}><span className="si" style={{ background: "var(--accent)" }}><Icon name="wallet" size="sm" /></span><span className="small muted">{t("fin.c.waiting")}</span><b>{R(waitingTotal)}</b>{d.unbilled.length > 0 && <span className="tabcnt">{d.unbilled.length}</span>}</Link>
            <Link href={q({ c: "toCheck" })} className={`chkpill ${checkTab === "toCheck" ? "on" : ""}`}><span className="si" style={{ background: "var(--warn)" }}><Icon name="hourglass" size="sm" /></span><span className="small muted">{t("fin.c.toCheck")}</span><b>{d.check.toCheck.length}</b>{d.check.toCheck.length > 0 && <span className="tabcnt">{d.check.toCheck.length}</span>}</Link>
            <Link href={q({ c: "auto" })} className={`chkpill ${checkTab === "auto" ? "on" : ""}`}><span className="si" style={{ background: "var(--ok)" }}><Icon name="check" size="sm" /></span><span className="small muted">{t("fin.c.auto")}</span><b>{d.check.auto.length}</b></Link>
          </div>
          {checkTab === "waiting" && waitingPackDue > 0 && (
            <p className="small muted mt-0 mb-4">
              {t("fin.waitingBreakdown", { other: R(waitingTotal - waitingPackDue), packs: R(waitingPackDue) })}
            </p>
          )}
          {/* проведённые уроки, за которые счёт ещё не выставлен: оплату можно подтвердить сразу */}
          {checkTab === "waiting" && d.unbilled.length > 0 && (
            <section className="card mb-4">
              <div className="flex items-baseline gap-2"><h3 className="m-0">{t("lp.noInvTitle")}</h3><span className="tabcnt">{d.unbilled.length}</span></div>
              <p className="small muted mt-1">{t("lp.noInvHint2")}</p>
              <div className="paylist">
                {d.unbilled.map((l) => (
                  <div key={l.id} className="payrow">
                    <StudentAvatar id={l.student.id} avatar={l.student.avatar} size={36} />
                    <span className="grow min-w-0"><b className="block truncate">{l.student.name} {l.student.lastName ?? ""}</b><span className="small muted">{dtt(l.startsAt)}</span></span>
                    <span className="payamt">{R(l.amount)}</span>
                    <span className="payrow-act"><PayLaterBtn id={l.id} /><LessonPaidBtn id={l.id} soft /></span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {/* «Оплатит позже»: копятся до оплаты (постоплата за неделю/месяц) — это недополученные деньги */
          checkTab === "waiting" && d.later.length > 0 && (
            <section className="card mb-4">
              <div className="flex flex-wrap items-baseline gap-2"><h3 className="m-0 grow">{t("lp.laterTitle")}</h3><span className="small muted">{t("lp.laterSum")}</span><b className="text-bad">{R(d.laterSum)}</b></div>
              <p className="small muted mt-1">{t("lp.laterHint")}</p>
              <div className="paylist">
                {d.later.map((l) => (
                  <div key={l.id} className="payrow">
                    <StudentAvatar id={l.student.id} avatar={l.student.avatar} size={36} />
                    <span className="grow min-w-0"><b className="block truncate">{l.student.name} {l.student.lastName ?? ""}</b><span className="small muted">{dtt(l.startsAt)}</span></span>
                    <span className="payamt">{R(l.amount)}</span>
                    <span className="payrow-act"><PayLaterBtn id={l.id} back /><LessonPaidBtn id={l.id} soft /></span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div className="flex flex-col gap-2">
            {rows.length === 0 && !(checkTab === "waiting" && (d.unbilled.length || d.later.length)) && <div className="card"><p className="hint m-0">{t("fin.c.empty")}</p></div>}
            {rows.map((i) => {
              const ai = i.aiRead as { amounts?: number[]; matches?: boolean; source?: string } | null;
              return (
                <div key={i.id} id={`inv-${i.id}`} className={`chkrow ${checkTab === "auto" ? "auto" : ""} ${sp.hl === i.id ? "hl" : ""}`}>
                  <span className="avatar lg">{initials(i.student.name, i.student.lastName)}</span>
                  <div className="w-56 min-w-0"><b className="block truncate">{i.student.name} {i.student.lastName}</b><span className="small">{i.title}</span>{i.payerName && <span className="small muted block">{t("fin.payer", { name: i.payerName })}</span>}</div>
                  <div className="grow min-w-[200px] flex-1">
                    {!i.proofAt ? (
                      <><span className="small text-text3 block">{t("fin.nothingSent")}{i.remindCount ? ` · ${t("fin.reminded", { n: i.remindCount })}` : ""}</span><ResendLink id={i.id} /></>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        {i.proofFile && <a href={i.proofFile} target="_blank" rel="noreferrer" className="pill blue"><Icon name="image" size="sm" />{t("fin.screenshot")}</a>}
                        {i.proofText && <span className="small"><Icon name="msg" size="sm" /> {i.proofText}</span>}
                        {ai?.source === "text" && <span className={`pill ${ai.matches ? "green" : "red"}`}>{ai.matches ? t("fin.matches") : t("fin.noMatch")}</span>}
                        {ai?.source === "screenshot" && (ai.matches
                          ? <span className="pill green"><Icon name="spark" size="sm" />{t("fin.aiRead", { sum: R(i.amount) })}</span>
                          : <span className="pill orange"><Icon name="spark" size="sm" />{ai.amounts?.length ? t("fin.aiOther", { sum: ai.amounts.map(R).join(", ") }) : t("fin.aiNone")}</span>)}
                      </div>
                    )}
                  </div>
                  <span className="amt">{R(i.amount)}</span>
                  <InvoiceEdit id={i.id} />
                  <CheckActions id={i.id} kind={checkTab as "waiting" | "toCheck" | "auto"} />
                </div>
              );
            })}
            {checkTab !== "auto" && rows.length > 0 && <div className="mt-2 flex items-center justify-between px-4"><b>{t("fin.stillToReceive")}</b><span className="amt big">{R(rows.reduce((a, i) => a + i.amount, 0))}</span></div>}
          </div>
          <RecentPaid teacherId={me.id} R={R} loc={loc} tz={me.timezone} t={t} />
        </>
      )}
    </div>
  );
}

async function RecentPaid({ teacherId, R, loc, tz, t }: { teacherId: string; R: (n: number) => string; loc: string; tz: string; t: (k: never, v?: Record<string, string | number>) => string }) {
  const paid = await db.invoice.findMany({ where: { student: { teacherId }, status: "PAID", closedAt: { not: null } }, include: { student: true }, orderBy: { paidAt: "desc" }, take: 15 });
  if (!paid.length) return null;
  return (
    <section className="card mt-6">
      <h3 className="mb-3">{t("fin.recentPaid" as never)}</h3>
      {paid.map((i) => (
        <div key={i.id} className="row wrap-phone">
          <span className="pill green">✓</span>
          <div className="grow"><b className="block">{i.student.name} {i.student.lastName}</b><span className="small muted">{i.title} · {i.paidAt?.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: tz })}</span></div>
          <b>{R(i.amount)}</b>
          <InvoiceEdit id={i.id} />
          {i.receiptFile && <a className="pill blue" href={i.receiptFile} target="_blank" rel="noreferrer">{t("pay.receipt" as never)}</a>}
          <ReceiptButton id={i.id} has={!!i.receiptFile} />
          {/* подтвердили по ошибке — сутки можно отменить прямо здесь */}
          {!i.autoAccepted && i.paidAt && Date.now() - i.paidAt.getTime() < 864e5 && <UndoPaidBtn id={i.id} />}
        </div>
      ))}
    </section>
  );
}
