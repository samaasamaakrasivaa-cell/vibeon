import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { accessOf } from "@/lib/admin/features";

export const metadata = { title: "Тарифы" };

/** Тарифы: пока — тёплое «мы вам рады», срок пробного периода и первые шаги на платформе. Цены появятся позже. */
export default async function Plan() {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const p = await db.teacherProfile.findUnique({ where: { userId: me.id }, include: { plan: true } });
  const [students, lessons, held, courses, awards] = await Promise.all([
    db.student.count({ where: { teacherId: me.id } }),
    db.lessonInstance.count({ where: { teacherId: me.id } }),
    db.lessonInstance.count({ where: { teacherId: me.id, status: "DONE" } }),
    db.course.count({ where: { teacherId: me.id } }),
    db.award.count({ where: { teacherId: me.id } }),
  ]);
  const acc = p ? accessOf(p) : { state: "trial" as const, until: null };
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  const until = acc.until?.toLocaleDateString(loc, { day: "numeric", month: "long", ...(acc.until.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).replace(/ г\.$/, "") ?? "";
  const left = acc.until ? Math.max(0, Math.ceil((acc.until.getTime() - Date.now()) / 864e5)) : 0;
  const total = p?.trialUntil ? Math.max(1, Math.round((p.trialUntil.getTime() - me.createdAt.getTime()) / 864e5)) : 14;
  const steps = [
    { done: students > 0, label: t("pl2.s.invite"), href: "/teacher/students" },
    { done: lessons > 0, label: t("pl2.s.schedule"), href: "/teacher/schedule" },
    { done: !!me.telegramChatId, label: t("pl2.s.telegram"), href: "/teacher/profile" },
    { done: held > 0, label: t("pl2.s.lesson"), href: "/teacher/schedule" },
    { done: courses > 0, label: t("pl2.s.course"), href: "/teacher/courses" },
    { done: awards > 0, label: t("pl2.s.award"), href: "/teacher/students" },
  ];
  const doneN = steps.filter((s) => s.done).length;
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1 className="mb-5">{t("nav.plan")}</h1>
      <section className="card tfhero">
        <span className="tfhero-k">{acc.state === "paid" ? (p?.plan?.name ?? t("pl2.paid")) : t("pl2.trial")}</span>
        <h2 className="m-0">{t("pl2.hello", { n: me.name })}</h2>
        <p className="m-0">{acc.state === "paid" ? t("pl2.paidText", { d: until }) : acc.state === "trial" ? t("pl2.trialText", { d: until }) : acc.state === "blocked" ? t("acc.blocked") : t("pl2.expiredText", { d: until })}</p>
        {acc.state === "trial" && (
          <div className="tfbar"><span className="small">{t("pl2.daysLeft", { n: left })}</span><span className="tfprog"><i style={{ width: `${Math.min(100, Math.max(4, (left / total) * 100))}%` }} /></span></div>
        )}
      </section>
      <section className="card">
        <div className="mb-3 flex items-center gap-2"><h2 className="m-0 grow">{t("pl2.steps")}</h2><span className="small muted">{t("pl2.stepsDone", { n: doneN, total: steps.length })}</span></div>
        <ul className="tfsteps">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? "done" : ""}>
              <span className="tfcheck" aria-hidden="true">{s.done ? <Icon name="check" size="sm" /> : null}</span>
              <span className="grow">{s.label}</span>
              {!s.done && <Link href={s.href} className="alink small whitespace-nowrap">{t("pl2.go")} →</Link>}
            </li>
          ))}
        </ul>
        {doneN === steps.length && <div className="alert ok mt-3">🎉 {t("pl2.allDone")}</div>}
      </section>
      <section className="card pfask">
        <div className="grow"><b>{t("pl2.qTitle")}</b><p className="small muted m-0">{t("pl2.qSub")}</p></div>
        <Link href="/teacher/support" className="btn secondary">{t("nav.support")}</Link>
      </section>
    </div>
  );
}
