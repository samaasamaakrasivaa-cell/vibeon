import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/admin/access";
import { mrrOf, revenueByMonth, teacherRows } from "@/lib/admin/data";
import { rub } from "@/lib/admin/features";
import { db } from "@/lib/db";
import { AddPaymentButton } from "@/components/admin/AdminForms";

/** Финансы платформы: сколько принесли учителя — по месяцам, MRR, средний чек, все оплаты. */
export default async function AdminFinance() {
  const { t, lang } = await getT();
  await requireAdmin();
  const now = new Date();
  const rows = await teacherRows(now);
  const [mrr, months, total, pays, plans] = await Promise.all([
    mrrOf(rows), revenueByMonth(now),
    db.teacherPayment.aggregate({ _sum: { amount: true }, _count: true }),
    db.teacherPayment.findMany({ orderBy: { paidAt: "desc" }, take: 100, include: { teacher: { include: { user: { select: { name: true, lastName: true } } } }, plan: { select: { name: true } } } }),
    db.plan.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true, priceMonth: true, active: true } }),
  ]);
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  const thisM = months[11]?.sum ?? 0, prevM = months[10]?.sum ?? 0;
  const payers = rows.filter((r) => r.paidTotal > 0).length;
  const max = Math.max(1, ...months.map((m) => m.sum));
  const tiles = [
    { icon: "coin", c: "var(--violet)", v: rub(mrr), l: t("adm.k.mrr"), s: t("adm.k.arr", { v: rub(mrr * 12) }) },
    { icon: "wallet", c: "var(--accent)", v: rub(thisM), l: t("adm.thisMonth"), s: prevM ? t("adm.vsPrev", { v: rub(prevM) }) : "" },
    { icon: "chart", c: "var(--ok)", v: rub(total._sum.amount ?? 0), l: t("adm.totalRev"), s: t("adm.nPayments", { n: total._count }) },
    { icon: "users", c: "#FF9500", v: payers ? rub((total._sum.amount ?? 0) / payers) : "—", l: t("adm.ltv"), s: t("adm.ltvSub", { n: payers }) },
  ] as const;
  return (
    <div className="page">
      <div className="mb-5 flex flex-wrap items-center gap-3"><h1 className="m-0 grow">{t("adm.nav.finance")}</h1>
        <AddPaymentButton teachers={rows.map((r) => ({ id: r.id, name: r.name }))} plans={plans} /></div>
      <section className="card">
        <div className="grid-3">{tiles.map((x) => <div key={x.l} className="fintile"><span className="si" style={{ background: x.c }}><Icon name={x.icon} /></span><div><b>{x.v}</b><span>{x.l}</span>{x.s && <span className="block small muted">{x.s}</span>}</div></div>)}</div>
      </section>
      <section className="card">
        <h2 className="mb-4">{t("adm.byMonth")}</h2>
        <div className="admbars" role="img" aria-label={t("adm.byMonth")}>
          {months.map((m) => (
            <div key={m.key} className="admbar" title={`${m.d.toLocaleDateString(loc, { month: "long", year: "numeric" })}: ${rub(m.sum)}`}>
              <span className="small">{m.sum ? Math.round(m.sum / 1000) + "k" : ""}</span>
              <i style={{ height: `${Math.max(2, (m.sum / max) * 100)}%` }} />
              <span className="small muted">{m.d.toLocaleDateString(loc, { month: "short" }).replace(".", "")}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="card p-0">
        <h2 className="p-5 pb-3 m-0">{t("adm.payments")}</h2>
        {pays.length === 0 ? <p className="hint m-0 px-5 pb-5">{t("adm.noPayments")}</p> : (
          <div className="tblwrap"><table className="admtbl">
            <thead><tr><th>{t("adm.c.date")}</th><th>{t("adm.c.teacher")}</th><th className="num">{t("adm.c.amount")}</th><th>{t("adm.c.plan")}</th><th>{t("adm.c.months")}</th><th>{t("adm.c.note")}</th></tr></thead>
            <tbody>{pays.map((p) => (
              <tr key={p.id}><td>{p.paidAt.toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td><Link href={`/admin/teachers/${p.teacherId}`} className="alink">{[p.teacher.user.name, p.teacher.user.lastName].filter(Boolean).join(" ")}</Link></td>
                <td className="num">{rub(p.amount)}</td><td>{p.plan?.name ?? "—"}</td><td>{p.months}</td><td className="small muted">{p.note ?? ""}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
