import { getT } from "@/lib/i18n/server";
import { db } from "@/lib/db";
import { ArticleBody } from "./ArticleBody";

/** «Помощь и новости» у учителя или ученика: опубликованные статьи базы знаний. */
export async function HelpPage({ audience }: { audience: "teacher" | "student" }) {
  const { t, lang } = await getT();
  const list = await db.article.findMany({ where: { published: true, audience: { in: [audience, "all"] } }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] });
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1 className="mb-5">{t("nav.help")}</h1>
      {list.length === 0 ? <section className="card"><p className="hint m-0">{t("help.none")}</p></section> : list.map((a) => (
        <details key={a.id} className="card artcard" open={a.pinned}>
          <summary><span className={`pill ${a.kind === "news" ? "blue" : a.kind === "digest" ? "violet" : "green"}`}>{t(`adm.kind.${a.kind}` as "adm.kind.guide")}</span><b className="grow">{a.title}</b><span className="small muted">{a.updatedAt.toLocaleDateString(loc, { day: "numeric", month: "short" })}</span></summary>
          <ArticleBody text={a.body} />
        </details>
      ))}
    </div>
  );
}
