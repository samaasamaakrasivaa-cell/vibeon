import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/admin/access";
import { accessOf, rub } from "@/lib/admin/features";
import { db } from "@/lib/db";
import { StatePill } from "@/components/admin/StatePill";
import { TeacherAdmin } from "@/components/admin/AdminForms";

/** Учитель глазами администратора: доступ, тариф, оплаты, активность, заметка. */
export default async function AdminTeacher({ params }: { params: Promise<{ id: string }> }) {
  const { t, lang } = await getT();
  await requireAdmin();
  const { id } = await params;
  const p = await db.teacherProfile.findUnique({ where: { userId: id }, include: { user: true, plan: true, payments: { orderBy: { paidAt: "desc" }, include: { plan: { select: { name: true } } } } } });
  if (!p) notFound();
  const since = new Date(Date.now() - 30 * 864e5);
  const [students, active, lessons30, lessonsAll, courses, groups] = await Promise.all([
    db.student.count({ where: { teacherId: id } }),
    db.student.count({ where: { teacherId: id, status: "ACTIVE" } }),
    db.lessonInstance.count({ where: { teacherId: id, status: "DONE", startsAt: { gte: since } } }),
    db.lessonInstance.count({ where: { teacherId: id, status: "DONE" } }),
    db.course.count({ where: { teacherId: id } }),
    db.group.count({ where: { teacherId: id } }),
  ]);
  const plans = await db.plan.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true, priceMonth: true, active: true } });
  const a = accessOf(p);
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  const d = (x: Date | null) => (x ? x.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" }) : "—");
  const name = [p.user.name, p.user.lastName].filter(Boolean).join(" ");
  return (
    <div className="page">
      <Link href="/admin/teachers" className="alink small">← {t("adm.nav.teachers")}</Link>
      <div className="mb-5 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="m-0">{name}</h1><StatePill state={a.state} />
      </div>
      <div className="admcols">
        <div className="flex min-w-0 flex-col gap-0">
          <section className="card">
            <dl className="kv">
              <dt>{t("adm.email")}</dt><dd>{p.user.email}</dd>
              <dt>{t("adm.registered")}</dt><dd>{d(p.user.createdAt)} · {t(p.source === "admin" ? "adm.src.admin" : "adm.src.signup")}</dd>
              <dt>{t("adm.seen")}</dt><dd>{p.user.lastSeenAt ? d(p.user.lastSeenAt) : t("adm.never")}</dd>
              <dt>{t("adm.trialUntil")}</dt><dd>{d(p.trialUntil)}</dd>
              <dt>{t("adm.paidUntil")}</dt><dd>{d(p.paidUntil)}</dd>
              <dt>{t("adm.c.plan")}</dt><dd>{p.plan ? `${p.plan.name} · ${rub(p.plan.priceMonth)}/${t("adm.mo")}` : "—"}</dd>
            </dl>
          </section>
          <section className="card">
            <h2 className="mb-3">{t("adm.usage")}</h2>
            <div className="grid-3">
              {[[students, t("adm.u.students", { n: active })], [lessons30, t("adm.c.lessons30")], [lessonsAll, t("adm.u.lessonsAll")], [courses, t("adm.u.courses")], [groups, t("adm.u.groups")]].map(([v, l]) => (
                <div key={String(l)} className="tile"><b className="block text-[22px]">{v}</b><span className="small muted">{l}</span></div>
              ))}
            </div>
          </section>
          <section className="card">
            <h2 className="mb-3">{t("adm.payments")}</h2>
            {p.payments.length === 0 ? <p className="hint m-0">{t("adm.noPayments")}</p> : (
              <div className="tblwrap"><table className="admtbl">
                <thead><tr><th>{t("adm.c.date")}</th><th className="num">{t("adm.c.amount")}</th><th>{t("adm.c.plan")}</th><th>{t("adm.c.months")}</th><th>{t("adm.c.note")}</th></tr></thead>
                <tbody>{p.payments.map((x) => <tr key={x.id}><td>{d(x.paidAt)}</td><td className="num">{rub(x.amount)}</td><td>{x.plan?.name ?? "—"}</td><td>{x.months}</td><td className="small muted">{x.note ?? ""}</td></tr>)}</tbody>
              </table></div>
            )}
          </section>
        </div>
        <TeacherAdmin id={id} name={name} planId={p.planId} plans={plans} blocked={!!p.blockedAt} note={p.adminNote ?? ""} />
      </div>
    </div>
  );
}
