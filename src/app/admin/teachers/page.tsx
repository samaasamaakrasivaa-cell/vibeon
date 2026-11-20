import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/admin/access";
import { teacherRows } from "@/lib/admin/data";
import { rub } from "@/lib/admin/features";
import { db } from "@/lib/db";
import { AddTeacher, TeacherInvites } from "@/components/admin/AdminForms";
import { env } from "@/lib/env";
import { isInternalEmail } from "@/lib/auth/cabinet";
import { StatePill } from "@/components/admin/StatePill";

const FILTERS = ["all", "trial", "paid", "expired", "blocked"] as const;

export default async function AdminTeachers({ searchParams }: { searchParams: Promise<{ s?: string; q?: string }> }) {
  const { t, lang } = await getT();
  await requireAdmin();
  const sp = await searchParams;
  const f = (FILTERS as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof FILTERS)[number]) : "all";
  const q = (sp.q ?? "").trim().toLowerCase();
  const [all, plans, invites] = await Promise.all([teacherRows(), db.plan.findMany({ where: { active: true }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.teacherInvite.findMany({ where: { usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 50 })]);
  const rows = all.filter((r) => (f === "all" || r.state === f) && (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)));
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  const d = (x: Date | null) => (x ? x.toLocaleDateString(loc, { day: "numeric", month: "short", year: "2-digit" }) : "—");
  const seen = (x: Date | null) => { if (!x) return t("adm.never"); const days = Math.floor((Date.now() - +x) / 864e5); return days < 1 ? t("adm.today") : t("adm.daysAgo", { n: days }); };
  return (
    <div className="page">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="m-0 grow">{t("adm.nav.teachers")}</h1>
        <AddTeacher plans={plans} />
      </div>
      <TeacherInvites list={invites.map((x) => ({ id: x.id, name: [x.name, x.lastName].filter(Boolean).join(" "), link: `${env.appUrl}/ti/${x.code}`, until: d(x.expiresAt) }))} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="seg nowrap">{FILTERS.map((k) => <Link key={k} href={`?s=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={f === k ? "page" : undefined}>{t(`adm.f.${k}` as "adm.f.all")} <span className="muted">{k === "all" ? all.length : all.filter((r) => r.state === k).length}</span></Link>)}</div>
        <form className="grow" style={{ minWidth: 200, maxWidth: 320 }}><input type="hidden" name="s" value={f} /><input className="input" name="q" defaultValue={sp.q ?? ""} placeholder={t("adm.search")} aria-label={t("adm.search")} /></form>
      </div>
      <section className="card p-0">
        {rows.length === 0 ? <p className="hint m-0 p-5">{t("adm.noTeachers")}</p> : (
          <div className="tblwrap">
            <table className="admtbl">
              <thead><tr><th>{t("adm.c.teacher")}</th><th>{t("adm.c.access")}</th><th>{t("adm.c.plan")}</th><th className="num">{t("adm.c.students")}</th><th className="num">{t("adm.c.lessons30")}</th><th>{t("adm.c.seen")}</th><th className="num">{t("adm.c.paid")}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/admin/teachers/${r.id}`} className="admname"><b>{r.name}</b><span className="small muted">{r.email}</span></Link></td>
                    <td><StatePill state={r.state} />{r.until && <span className="block small muted mt-1">{t("adm.until", { d: d(r.until) })}</span>}</td>
                    <td>{r.plan?.name ?? <span className="muted">—</span>}</td>
                    <td className="num">{r.students}</td>
                    <td className="num">{r.lessons30}</td>
                    <td className="small">{seen(r.lastSeenAt)}</td>
                    <td className="num">{r.paidTotal ? rub(r.paidTotal) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
