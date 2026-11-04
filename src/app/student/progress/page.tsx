import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Прогресс" };

export default async function Progress() {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  if (!s) return null;
  const [done, feedback] = await Promise.all([
    db.lessonInstance.findMany({ where: { studentId: s.id, status: "DONE", templateId: { not: null } }, include: { template: { include: { unit: true } } }, orderBy: { startsAt: "desc" } }),
    db.feedback.findMany({ where: { studentId: s.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const topics = [...new Map(done.map((l) => [l.template!.id, l.template!])).values()];
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <div className="page">
      <h1 className="mb-5">{t("nav.progress")}</h1>
      <section className="card">
        <h2 className="mb-3">{t("pg.topics")}</h2>
        {topics.length === 0 ? <p className="hint m-0">{t("pg.noTopics")}</p> : (
          <div className="flex flex-wrap gap-2">{topics.map((x) => <span key={x.id} className="pill blue">{x.title}{x.subtitle ? ` · ${x.subtitle}` : ""}</span>)}</div>
        )}
      </section>
      <section className="card">
        <h2 className="mb-3">{t("prof.tab.feedback")}</h2>
        {feedback.length === 0 ? <p className="hint m-0">{t("pg.noFeedback")}</p> : feedback.map((f) => (
          <div key={f.id} className="tile mb-2"><div className="small muted mb-1">{f.createdAt.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: me.timezone })}</div>{f.text}</div>
        ))}
      </section>
      <Link href="/student/route" className="card flex items-center justify-between gap-3 hover:bg-fill"><span className="muted">{t("pg.soon")}</span><span className="alink whitespace-nowrap">{t("nav.route")} →</span></Link>
    </div>
  );
}
