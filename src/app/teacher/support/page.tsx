import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { SupportChat } from "@/components/admin/SupportChat";

export const metadata = { title: "Поддержка" };

/** Поддержка: сначала быстрые ответы из базы знаний, ниже — чат с командой платформы. */
export default async function Support() {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const [msgs, popular] = await Promise.all([
    db.supportMessage.findMany({ where: { userId: me.id }, orderBy: { createdAt: "asc" }, take: 300 }),
    db.article.findMany({ where: { published: true, kind: "guide", audience: { in: ["teacher", "all"] } }, orderBy: [{ pinned: "desc" }, { helpfulYes: "desc" }, { updatedAt: "desc" }], take: 4, select: { id: true, title: true } }),
  ]);
  // открыл чат — ответы поддержки прочитаны
  const marked = await db.supportMessage.updateMany({ where: { userId: me.id, fromAdmin: true, readAt: null }, data: { readAt: new Date() } });
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  const when = (d: Date) => d.toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: me.timezone });
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1 className="mb-2">{t("nav.support")}</h1>
      <p className="muted mt-0 mb-5">{t("sp.lead")}</p>
      {popular.length > 0 && (
        <section className="card">
          <h2 className="mb-3">{t("sp.quick")}</h2>
          <div className="flex flex-wrap gap-2">
            {popular.map((a) => <Link key={a.id} href={`/teacher/platform/${a.id}`} className="pchip">{a.title}</Link>)}
            <Link href="/teacher/platform?tab=kb" className="pchip">{t("sp.allKb")} →</Link>
          </div>
        </section>
      )}
      <section className="card">
        <h2 className="mb-1">{t("sp.chat")}</h2>
        <p className="small muted mt-0 mb-3">{t("sp.chatSub")}</p>
        <SupportChat to={null} hadUnread={marked.count > 0} empty={t("sp.empty")} msgs={msgs.map((m) => ({ id: m.id, mine: !m.fromAdmin, text: m.text, when: when(m.createdAt), who: m.fromAdmin ? t("sp.team") : undefined }))} />
      </section>
    </div>
  );
}
