import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CheckActions, PayDetails, ReceiptButton, ResendLink } from "@/components/finance/FinanceParts";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { financeData, type Range } from "@/lib/billing/finance";
import { initials } from "@/lib/invite";
import { rub } from "@/lib/teacher/data";

export const metadata = { title: "Финансы" };
export const dynamic = "force-dynamic";

const TABS = ["updates", "income", "students", "check"] as const;

export default async function Finance({ searchParams }: { searchParams: Promise<{ tab?: string; r?: string; c?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "updates";
  const range: Range = sp.r === "week" || sp.r === "all" ? sp.r : "month";
  const d = await financeData(me.id, me.timezone, range);
  const prof = await db.teacherProfile.findUnique({ where: { userId: me.id } });
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const R = (n: number) => rub(n, lang);
  const pct = (n: number) => (d.total ? Math.round((n / d.total) * 100) : 0);
  const title = range === "month" ? ((m) => m.charAt(0).toUpperCase() + m.slice(1))(new Date().toLocaleDateString(loc, { month: "long", year: "numeric", timeZone: me.timezone }).replace(/\s*г\.$/, "")) : range === "week" ? t("fin.thisWeek") : t("fin.allTime");
  const q = (p: Record<string, string>) => `?${new URLSearchParams({ tab, r: range, ...p })}`;
  const checkTab = sp.c === "toCheck" || sp.c === "auto" ? sp.c : "waiting";
  const rows = d.check[checkTab as keyof typeof d.check];
  const daysSince = d.oldestProof ? Math.floor((Date.now() - d.oldestProof.getTime()) / 864e5) : 0;
  const maxM = Math.max(1, ...d.months.flatMap((m) => [m.earned, m.received]));
  const maxS = Math.max(1, ...d.perStudent.map((p) => p.earned));
  const insightText: Record<string, (v: Record<string, string | number>) => string> = {
    cancels: (v) => t("fin.ins.cancels", v), moves: (v) => t("fin.ins.moves", v), debt: (v) => t("fin.ins.debt", { name: v.name, sum: R(Number(v.sum)) }), ending: (v) => t("fin.ins.ending", v),
  };
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
        {TABS.map((k) => <Link key={k} href={q({ tab: k })} aria-current={tab === k ? "page" : undefined}>{t(`fin.tab.${k}`)}{k === "check" && d.check.toCheck.length > 0 && <span className="dot ml-1.5" style={{ background: "var(--warn)" }} />}</Link>)}
      </nav>

      {tab === "updates" && (
        <>
          <h2 className="mb-4">{title}</h2>
          <div className="grid-3">
            <div className="fintile main"><span className="si"><Icon name="coin" /></span><div><b>{R(d.earned)}</b><span>{t("fin.earned")}</span></div></div>
            <div className="fintile"><span className="si" style={{ background: "var(--accent)" }}><Icon name="wallet" /></span><div><b>{R(d.received)}</b><span>{t("fin.received")}</span></div></div>
            <div className="fintile"><span className="si" style={{ background: "var(--warn)" }}><Icon name="hourglass" /></span><div><b className={d.waiting ? "text-bad" : ""}>{R(d.waiting)}</b><span>{t("fin.waiting")}</span></div></div>
            <div className="fintile"><span className="si" style={{ background: "var(--violet)" }}><Icon name="gift" /></span><div><b>{R(d.prepaid)}</b><span>{t("fin.prepaid")}</span></div></div>
            <div className="fintile"><span className="si" style={{ background: "var(--bad)" }}><Icon name="calx" /></span><div><b>{pct(d.cancelled)}%</b><span>{t("fin.cancelled", { n: d.cancelled, total: d.total })}</span></div></div>
            <div className="fintile"><span className="si" style={{ background: "#5AC8FA" }}><Icon name="move" /></span><div><b>{pct(d.moved)}%</b><span>{t("fin.moved", { n: d.moved, total: d.total })}</span></div></div>
          </div>
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
          <h2 className="mb-1">{t("fin.byMonth")}</h2>
          <div className="legend mb-4"><span><i style={{ background: "var(--ok)" }} />{t("fin.earnedShort")}</span><span><i style={{ background: "var(--accent)" }} />{t("fin.receivedShort")}</span></div>
          <div className="bars">
            {d.months.map((m) => (
              <div key={m.key} className="barcol">
                <div className="barpair">
                  <i style={{ height: `${(m.earned / maxM) * 100}%`, background: "var(--ok)" }} title={R(m.earned)} />
                  <i style={{ height: `${(m.received / maxM) * 100}%`, background: "var(--accent)" }} title={R(m.received)} />
                </div>
                <b className="small">{R(m.earned)}</b>
                <span className="small muted">{m.start.toLocaleDateString(loc, { month: "short", timeZone: me.timezone }).replace(".", "")}</span>
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
                <span className={`fr-debt text-right small ${p.debt ? "text-bad font-semibold" : "text-text3"}`}>{p.debt ? t("fin.debt", { sum: R(p.debt) }) : "—"}</span>
              </div>
            ))}
            {d.perStudent.length === 0 && <p className="hint m-0">{t("inviteT.none")}</p>}
          </div>
        </section>
      )}

      {tab === "check" && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Link href={q({ c: "waiting" })} className={`chkpill ${checkTab === "waiting" ? "on" : ""}`}><span className="si" style={{ background: "var(--accent)" }}><Icon name="wallet" size="sm" /></span><span className="small muted">{t("fin.c.waiting")}</span><b>{R(d.check.waiting.reduce((a, i) => a + i.amount, 0))}</b></Link>
            <Link href={q({ c: "toCheck" })} className={`chkpill ${checkTab === "toCheck" ? "on" : ""}`}><span className="si" style={{ background: "var(--warn)" }}><Icon name="hourglass" size="sm" /></span><span className="small muted">{t("fin.c.toCheck")}</span><b>{d.check.toCheck.length}</b></Link>
            <Link href={q({ c: "auto" })} className={`chkpill ${checkTab === "auto" ? "on" : ""}`}><span className="si" style={{ background: "var(--ok)" }}><Icon name="check" size="sm" /></span><span className="small muted">{t("fin.c.auto")}</span><b>{d.check.auto.length}</b></Link>
          </div>
          <div className="flex flex-col gap-2">
            {rows.length === 0 && <div className="card"><p className="hint m-0">{t("fin.c.empty")}</p></div>}
            {rows.map((i) => {
              const ai = i.aiRead as { amounts?: number[]; matches?: boolean; source?: string } | null;
              return (
                <div key={i.id} className={`chkrow ${checkTab === "auto" ? "auto" : ""}`}>
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
          {i.receiptFile && <a className="pill blue" href={i.receiptFile} target="_blank" rel="noreferrer">{t("pay.receipt" as never)}</a>}
          <ReceiptButton id={i.id} has={!!i.receiptFile} />
        </div>
      ))}
    </section>
  );
}
