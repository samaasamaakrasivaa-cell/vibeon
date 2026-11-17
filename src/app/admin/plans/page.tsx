import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/admin/access";
import { FEATURES, rub } from "@/lib/admin/features";
import { db } from "@/lib/db";
import { PlanEdit } from "@/components/admin/AdminForms";

/** Тарифы для учителей: цена, ограничения, что входит; правятся здесь же. */
export default async function AdminPlans() {
  const { t, lang } = await getT();
  await requireAdmin();
  const plans = await db.plan.findMany({ orderBy: { order: "asc" }, include: { _count: { select: { teachers: true } } } });
  const L = lang === "en" ? "en" : "ru";
  return (
    <div className="page">
      <div className="mb-2 flex flex-wrap items-center gap-3"><h1 className="m-0 grow">{t("adm.nav.plans")}</h1><PlanEdit plan={null} /></div>
      <p className="muted mt-0 mb-5">{t("adm.plansHint")}</p>
      <div className="admplans">
        {plans.map((p) => {
          const feats = (p.features as string[]) ?? [];
          return (
            <section key={p.id} className={`card admplan ${p.active ? "" : "off"}`}>
              <div className="flex items-start gap-2">
                <div className="grow min-w-0"><h2 className="m-0">{L === "en" && p.nameEn ? p.nameEn : p.name}</h2>{p.blurb && <p className="small muted mb-0 mt-1">{p.blurb}</p>}</div>
                {!p.active && <span className="pill grey">{t("adm.archived")}</span>}
              </div>
              <div className="admprice"><b>{rub(p.priceMonth)}</b><span className="muted">/{t("adm.mo")}</span>{p.priceYear ? <span className="small muted block">{t("adm.perYear", { p: rub(p.priceYear) })}</span> : null}</div>
              <ul className="admlimits">
                <li>{p.maxStudents === null ? t("adm.studentsUnl") : t("adm.studentsMax", { n: p.maxStudents })}</li>
                <li>{p.aiPerMonth === 0 ? t("adm.aiNone") : p.aiPerMonth === null ? t("adm.aiUnl") : t("adm.aiMax", { n: p.aiPerMonth })}</li>
              </ul>
              <ul className="admfeats">
                {FEATURES.map((f) => <li key={f.key} className={feats.includes(f.key) ? "on" : "no"}><span aria-hidden="true">{feats.includes(f.key) ? "✓" : "—"}</span>{f[L]}</li>)}
              </ul>
              <div className="mt-auto flex items-center gap-2 pt-3"><span className="small muted grow">{t("adm.planTeachers", { n: p._count.teachers })}</span>
                <PlanEdit plan={{ id: p.id, name: p.name, nameEn: p.nameEn ?? "", tier: p.tier === "PRO" ? "PRO" : "START", priceMonth: p.priceMonth, priceYear: p.priceYear, maxStudents: p.maxStudents, aiPerMonth: p.aiPerMonth, features: feats, blurb: p.blurb ?? "", active: p.active, teachers: p._count.teachers }} />
              </div>
            </section>
          );
        })}
      </div>
      <p className="hint mt-4">{t("adm.plansLimitNote")}</p>
    </div>
  );
}
