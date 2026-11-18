import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/admin/access";
import { db } from "@/lib/db";

/** Поддержка: все переписки — сверху те, где ждут ответа. */
export default async function AdminSupport() {
  const { t, lang } = await getT();
  await requireAdmin();
  const last = await db.supportMessage.findMany({ orderBy: { createdAt: "desc" }, distinct: ["userId"], include: { user: { select: { name: true, lastName: true, email: true, role: true } } }, take: 200 });
  const unread = await db.supportMessage.groupBy({ by: ["userId"], where: { fromAdmin: false, readAt: null }, _count: { _all: true } });
  const un = new Map(unread.map((u) => [u.userId, u._count._all]));
  const rows = [...last].sort((a, b) => (un.get(b.userId) ?? 0) - (un.get(a.userId) ?? 0) || +b.createdAt - +a.createdAt);
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <h1 className="mb-2">{t("nav.support")}</h1>
      <p className="muted mt-0 mb-5">{t("sp.adminLead")}</p>
      <section className="card p-0">
        {rows.length === 0 ? <p className="hint m-0 p-5">{t("sp.none")}</p> : (
          <ul className="kblist">
            {rows.map((m) => (
              <li key={m.userId}><Link href={`/admin/support/${m.userId}`}>
                <span className="grow min-w-0">
                  <b>{[m.user.name, m.user.lastName].filter(Boolean).join(" ")}</b> <span className="small muted">{m.user.email} · {m.user.role === "TEACHER" ? t("adm.aud.teacher") : t("adm.aud.student")}</span>
                  <span className="block small muted truncate">{m.fromAdmin ? `${t("sp.you")}: ` : ""}{m.text}</span>
                </span>
                {(un.get(m.userId) ?? 0) > 0 && <span className="pill red">{un.get(m.userId)}</span>}
                <span className="small muted nowrap">{m.createdAt.toLocaleDateString(loc, { day: "numeric", month: "short" })}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
