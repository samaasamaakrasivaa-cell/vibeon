import Link from "next/link";
import { Icon } from "@/components/Icon";
import { BuyPack, MessageButton, PaidButton } from "@/components/student/PaymentsParts";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { packOptions } from "@/lib/billing/engine";
import { rub } from "@/lib/teacher/data";

export const metadata = { title: "Оплаты" };
export const dynamic = "force-dynamic";

export default async function Payments({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id }, include: { packs: { orderBy: { startsAt: "desc" } }, invoices: { orderBy: { createdAt: "desc" } }, teacher: true } });
  if (!s) return null;
  const tab = (await searchParams).tab === "bills" ? "bills" : "tariff";
  const R = (n: number) => rub(n, lang);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const date = (d: Date) => d.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric", timeZone: me.timezone });
  const open = s.invoices.filter((i) => i.status === "SENT" || i.status === "PROOF_SENT");
  const history = s.invoices.filter((i) => i.status === "PAID");
  const pack = s.packs.find((p) => p.lessonsLeft > 0) ?? s.packs[0];
  const left = s.packs.reduce((a, p) => a + p.lessonsLeft, 0);
  const opts = packOptions(s);
  const details = ((s.teacher.settings as { payDetails?: string })?.payDetails) ?? "";
  const circ = 2 * Math.PI * 50;
  const weekly = await db.lessonInstance.count({ where: { studentId: s.id, status: "PLANNED", startsAt: { gt: new Date(), lt: new Date(Date.now() + 7 * 864e5) } } });
  return (
    <div className="page">
      <h1 className="mb-5">{t("nav.payments")}</h1>
      <nav className="tabsbar fit mb-6">
        <Link href="?tab=tariff" aria-current={tab === "tariff" ? "page" : undefined}>{t("pay.tariff")}</Link>
        <Link href="?tab=bills" aria-current={tab === "bills" ? "page" : undefined}>{t("pay.bills")}{open.some((i) => i.status === "SENT") && <span className="dot ml-1.5" style={{ background: "var(--warn)" }} />}</Link>
      </nav>

      {tab === "tariff" && (s.payType === "PACK" ? (
        <>
          <section>
            <div className="packhead">
              <div><div className="small opacity-90">{t("pay.yourPack")}</div><b className="text-[19px]">{pack ? t("pay.lessonsN", { n: pack.lessonsTotal }) : t("pay.noPack")}</b>{weekly ? <div className="small opacity-90">{t("pay.perWeek", { n: weekly })}</div> : null}</div>
              <div className="flex gap-2">
                <MessageButton label={t("pay.freeze")} icon="clock" className="btn sm" text={t("pay.freezeText")} />
                {opts.length > 0 && <BuyPack n={(opts.find((o) => o.n === pack?.lessonsTotal) ?? opts[opts.length - 1]).n} label={`+ ${t("pay.extend")}`} className="btn secondary sm" />}
              </div>
            </div>
            <div className="packbody">
              <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--fill)" strokeWidth="11" />
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--ok)" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${pack ? (circ * left) / Math.max(1, pack.lessonsTotal) : 0} ${circ}`} transform="rotate(-90 60 60)" />
                <text x="60" y="64" textAnchor="middle" fontSize="30" fontWeight="700" fill="var(--text)">{left}</text>
                <text x="60" y="83" textAnchor="middle" fontSize="12" fill="var(--text2)">{t("prof.leftShort")}</text>
              </svg>
              <div>
                <b className="text-[20px]">{pack ? t("pay.leftOf", { n: left, total: pack.lessonsTotal }) : t("pay.noPack")}</b>
                {pack?.frozenUntil && <div className="small muted">{t("pay.frozen", { d: date(pack.frozenUntil) })}</div>}
                <p className="mb-0 mt-1 muted">{t("pay.deductRule")}</p>
              </div>
            </div>
          </section>
          {opts.length > 1 && (
            <section className="card mt-5" style={{ background: "linear-gradient(135deg, var(--accent-bg), var(--surface))" }}>
              <div className="cardtitle">{t("pay.faster")}</div>
              <div className="flex flex-wrap gap-3">
                {opts.map((o) => (
                  <div key={o.n} className="offer"><b className="block">{t("pay.lessonsN", { n: o.n })}</b><b className="text-[22px]">{R(o.price)}</b><div className="small muted mb-2">{R(Math.round(o.price / o.n))} {t("pay.perLesson")}</div><BuyPack n={o.n} label={t("pay.choose")} /></div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="card">
            <div className="cardtitle">{t("pay.postpaidTitle")}</div>
            <b className="text-[24px]">{s.price ? R(s.price) : "—"}</b> <span className="muted">{t("pay.perLesson")}</span>
            <p className="muted mb-0">{t("pay.postpaidRule")}</p>
          </section>
          {opts.length > 0 && (
            <section className="card" style={{ background: "linear-gradient(135deg, var(--accent-bg), var(--surface))" }}>
              <div className="cardtitle">{t("pay.packOffer")}</div>
              <div className="flex flex-wrap gap-3">{opts.map((o) => <div key={o.n} className="offer"><b className="block">{t("pay.lessonsN", { n: o.n })}</b><b className="text-[22px]">{R(o.price)}</b><div className="small muted mb-2">{R(Math.round(o.price / o.n))} {t("pay.perLesson")}{s.price && o.price < s.price * o.n ? ` · ${t("pay.save", { sum: R(s.price * o.n - o.price) })}` : ""}</div><BuyPack n={o.n} label={t("pay.switch")} /></div>)}</div>
            </section>
          )}
        </>
      ))}

      {tab === "bills" && (
        <>
          {open.length === 0 && <div className="card"><p className="m-0">✓ {t("pay.allPaid")}</p></div>}
          {open.map((i) => (
            <section key={i.id} className="paycard mb-4">
              {i.status === "SENT" ? <span className="badge"><Icon name="bell" size="sm" /> {t("pay.billed")}</span> : <span className="badge">{t("pay.checking")}</span>}
              <div className="opacity-90">{t("pay.toPay")}</div>
              <div className="mt-1 text-[34px] font-bold tracking-tight">{R(i.amount)}</div>
              <div className="opacity-90">{i.title}{i.packLessons && s.price ? ` · ${i.packLessons} × ${R(Math.round(i.amount / i.packLessons))}` : ""}</div>
              {i.period && <div className="mt-2 inline-flex rounded-full bg-white/20 px-3 py-1 text-[13px]"><Icon name="cal" size="sm" />&nbsp;{i.period}</div>}
              {details ? <div className="det mt-3"><Icon name="card" size="sm" /> {details}</div> : <div className="det mt-3 opacity-80">{t("pay.noDetails")}</div>}
              <p className="small mb-3 mt-3 opacity-90"><Icon name="info" size="sm" /> {t("pay.howProof")}</p>
              <div className="flex flex-wrap gap-2">
                {i.status === "SENT" ? <PaidButton id={i.id} amount={R(i.amount)} /> : <span className="btn light lg" aria-disabled="true" style={{ opacity: 0.8 }}>✓ {t("pay.proofSent")}</span>}
                <MessageButton label={t("pay.needReceipt")} icon="note" text={t("pay.receiptText", { title: i.title ?? "", amount: R(i.amount) })} />
              </div>
            </section>
          ))}
          <h2 className="mb-3 mt-8">{t("pay.history")}</h2>
          <section className="list">
            {history.length === 0 && <p className="hint p-5 m-0">{t("pay.noHistory")}</p>}
            {history.map((i) => (
              <div key={i.id} className="row">
                <span className="pill green">✓ {t("pay.paid")}</span>
                <div className="grow"><div className="t">{i.title}</div><div className="s">{i.paidAt ? date(i.paidAt) : ""}</div></div>
                {i.receiptFile && <a className="btn tinted sm" href={i.receiptFile} target="_blank" rel="noreferrer"><Icon name="note" size="sm" />{t("pay.yourReceipt")}</a>}
                <b>{R(i.amount)}</b>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
