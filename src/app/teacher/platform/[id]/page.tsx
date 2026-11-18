import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { KB_TOPICS, readMin } from "@/lib/admin/features";
import { ArticleBody } from "@/components/admin/ArticleBody";
import { Helpful } from "@/components/admin/Helpful";

/** Статья базы знаний: текст, «помогла?», ещё статьи раздела и «напишите в поддержку». */
export default async function KbArticle({ params }: { params: Promise<{ id: string }> }) {
  const { t, lang } = await getT();
  await requireUser("TEACHER");
  const { id } = await params;
  const a = await db.article.findUnique({ where: { id } });
  if (!a || !a.published || !["teacher", "all"].includes(a.audience)) notFound();
  const L = lang === "en" ? "en" : "ru";
  const topic = KB_TOPICS.find((k) => k.key === (a.topic ?? "other"));
  const more = await db.article.findMany({ where: { published: true, kind: "guide", audience: { in: ["teacher", "all"] }, topic: a.topic, id: { not: a.id } }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, title: true } });
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <Link href="/teacher/platform?tab=kb" className="alink small">← {t("pf.kb")}{topic ? ` · ${topic[L]}` : ""}</Link>
      <article className="card mt-3">
        <span className="small muted">{t("pf.min", { n: readMin(a.body) })}</span>
        <h1 className="mb-4 mt-1">{a.title}</h1>
        <ArticleBody text={a.body} />
        <Helpful id={a.id} />
      </article>
      {more.length > 0 && (
        <section className="card">
          <h2 className="mb-3">{t("pf.more")}</h2>
          <ul className="kblist">{more.map((m) => <li key={m.id}><Link href={`/teacher/platform/${m.id}`}><b className="grow">{m.title}</b></Link></li>)}</ul>
        </section>
      )}
      <section className="card pfask">
        <div className="grow"><b>{t("pf.askTitle")}</b><p className="small muted m-0">{t("pf.askSub")}</p></div>
        <Link href="/teacher/support" className="btn primary">{t("pf.askBtn")}</Link>
      </section>
    </div>
  );
}
