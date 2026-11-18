import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/admin/access";
import { db } from "@/lib/db";
import { ArticleEdit } from "@/components/admin/AdminForms";
import { ArticleBody } from "@/components/admin/ArticleBody";

/** База знаний: инструкции, дайджест, новости — для учителей и учеников («Помощь» в их кабинетах). */
export default async function AdminKb() {
  const { t, lang } = await getT();
  await requireAdmin();
  const list = await db.article.findMany({ orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] });
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <div className="mb-2 flex flex-wrap items-center gap-3"><h1 className="m-0 grow">{t("adm.nav.kb")}</h1><ArticleEdit a={null} /></div>
      <p className="muted mt-0 mb-5">{t("adm.kbHint")}</p>
      {list.length === 0 && <section className="card"><p className="hint m-0">{t("help.none")}</p></section>}
      {list.map((a) => (
        <details key={a.id} className="card artcard">
          <summary>
            <span className={`pill ${a.kind === "news" ? "blue" : a.kind === "digest" ? "violet" : "green"}`}>{t(`adm.kind.${a.kind}` as "adm.kind.guide")}</span>
            <b className="grow">{a.title}</b>
            <span className="pill grey">{t(`adm.aud.${a.audience}` as "adm.aud.all")}</span>
            {a.published ? <span className="pill green">{t("adm.published")}</span> : <span className="pill outline">{t("adm.draft")}</span>}
            {(a.helpfulYes > 0 || a.helpfulNo > 0) && <span className="small muted" title={t("adm.helpful")}>👍 {a.helpfulYes} · 👎 {a.helpfulNo}</span>}
            <span className="small muted">{a.updatedAt.toLocaleDateString(loc, { day: "numeric", month: "short" })}</span>
          </summary>
          <ArticleBody text={a.body} />
          <div className="mt-3"><ArticleEdit a={{ id: a.id, title: a.title, body: a.body, kind: a.kind, audience: a.audience, published: a.published, pinned: a.pinned, topic: a.topic, tag: a.tag }} /></div>
        </details>
      ))}
    </div>
  );
}
