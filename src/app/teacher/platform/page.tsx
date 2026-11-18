import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { KB_TOPICS, NEWS_TAGS, readMin } from "@/lib/admin/features";
import { ArticleBody } from "@/components/admin/ArticleBody";
import { KbBrowser } from "@/components/admin/KbBrowser";

export const metadata = { title: "О платформе" };

/** О платформе: новости (что нового — лента с метками) и база знаний (как работать — разделы, поиск). */
export default async function Platform({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const tab = (await searchParams).tab === "kb" ? "kb" : "news";
  const L = lang === "en" ? "en" : "ru";
  const loc = L === "en" ? "en-GB" : "ru-RU";
  const where = { published: true, audience: { in: ["teacher", "all"] } };
  const [news, guides, prof] = await Promise.all([
    db.article.findMany({ where: { ...where, kind: { in: ["news", "digest"] } }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] }),
    db.article.findMany({ where: { ...where, kind: "guide" }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] }),
    db.teacherProfile.findUnique({ where: { userId: me.id }, select: { settings: true } }),
  ]);
  const settings = (prof?.settings ?? {}) as Record<string, unknown>;
  const seenAt = typeof settings.newsSeenAt === "string" ? new Date(settings.newsSeenAt) : null;
  // открыл новости — точка «новое» в меню гаснет (а в ленте помечаем, что вышло после прошлого визита)
  if (tab === "news" && prof) await db.teacherProfile.update({ where: { userId: me.id }, data: { settings: { ...settings, newsSeenAt: new Date().toISOString() } } });
  const unseen = news.filter((a) => !seenAt || a.updatedAt > seenAt).length;
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <h1 className="mb-2">{t("nav.platform")}</h1>
      <p className="muted mt-0 mb-5">{t("pf.lead")}</p>
      <nav className="tabsbar mb-6">
        <Link href="?tab=news" aria-current={tab === "news" ? "page" : undefined}>{t("pf.news")}{unseen > 0 && tab !== "news" && <span className="dot ml-1.5" style={{ background: "var(--accent)" }} />}</Link>
        <Link href="?tab=kb" aria-current={tab === "kb" ? "page" : undefined}>{t("pf.kb")}</Link>
      </nav>
      {tab === "news" ? (
        news.length === 0 ? <section className="card"><p className="hint m-0">{t("pf.noNews")}</p></section> : (
          <div className="pfnews">
            {news.map((a) => {
              const tag = NEWS_TAGS.find((x) => x.key === a.tag);
              const fresh = !seenAt || a.updatedAt > seenAt;
              return (
                <article key={a.id} className={`card pfnews-i ${fresh ? "fresh" : ""}`}>
                  <div className="pfnews-date"><b>{a.updatedAt.toLocaleDateString(loc, { day: "numeric" })}</b><span>{a.updatedAt.toLocaleDateString(loc, { month: "short" }).replace(".", "")}</span></div>
                  <div className="min-w-0 grow">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {tag ? <span className={`pill ${tag.color}`}>{tag[L]}</span> : a.kind === "digest" && <span className="pill violet">{t("adm.kind.digest")}</span>}
                      {fresh && <span className="small font-semibold text-accent">{t("pf.fresh")}</span>}
                    </div>
                    <h2 className="mb-2 mt-0">{a.title}</h2>
                    <ArticleBody text={a.body} />
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : (
        <KbBrowser
          topics={KB_TOPICS.map((k) => ({ key: k.key, name: k[L], icon: k.icon }))}
          items={guides.map((a) => ({ id: a.id, title: a.title, topic: a.topic ?? "other", pinned: a.pinned, min: readMin(a.body), text: a.body.slice(0, 600) }))}
          base="/teacher/platform"
        />
      )}
      <section className="card pfask">
        <div className="grow"><b>{t("pf.askTitle")}</b><p className="small muted m-0">{t("pf.askSub")}</p></div>
        <Link href="/teacher/support" className="btn primary">{t("pf.askBtn")}</Link>
      </section>
    </div>
  );
}
