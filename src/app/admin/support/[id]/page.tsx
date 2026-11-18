import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/admin/access";
import { db } from "@/lib/db";
import { SupportChat } from "@/components/admin/SupportChat";

/** Переписка с одним учителем: читаем и отвечаем; ответ придёт ему уведомлением. */
export default async function AdminSupportThread({ params }: { params: Promise<{ id: string }> }) {
  const { t, lang } = await getT();
  const me = await requireAdmin();
  const { id } = await params;
  const u = await db.user.findUnique({ where: { id }, select: { name: true, lastName: true, email: true, role: true } });
  if (!u) notFound();
  const msgs = await db.supportMessage.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" }, take: 500 });
  const marked = await db.supportMessage.updateMany({ where: { userId: id, fromAdmin: false, readAt: null }, data: { readAt: new Date() } });
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  const when = (d: Date) => d.toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: me.timezone });
  const name = [u.name, u.lastName].filter(Boolean).join(" ");
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <Link href="/admin/support" className="alink small">← {t("nav.support")}</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="m-0 grow">{name}</h1>
        {u.role === "TEACHER" && <Link href={`/admin/teachers/${id}`} className="btn secondary sm">{t("sp.profile")}</Link>}
      </div>
      <section className="card">
        <SupportChat to={id} hadUnread={marked.count > 0} empty={t("sp.none")} msgs={msgs.map((m) => ({ id: m.id, mine: m.fromAdmin, text: m.text, when: when(m.createdAt), who: m.fromAdmin ? undefined : name }))} />
      </section>
    </div>
  );
}
