import { Thread } from "@/components/Thread";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Сообщения" };

export default async function Messages() {
  const { t } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id }, include: { teacher: { include: { user: true } } } });
  if (!s) return null;
  const msgs = await db.message.findMany({ where: { studentId: s.id }, orderBy: { createdAt: "asc" }, take: 300 });
  const tu = s.teacher.user;
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1 className="mb-1">{t("nav.messages")}</h1>
      <p className="muted mt-0 mb-5">{t("msg.withTeacher", { name: [tu.name, tu.lastName].filter(Boolean).join(" ") })}</p>
      <section className="card">
        <Thread tz={me.timezone} studentId={s.id} me={me.id} names={{ [me.id]: me.name, [tu.id]: tu.name }} initial={msgs.map((m) => ({ id: m.id, text: m.text, by: m.senderId, at: m.createdAt.toISOString() }))} />
      </section>
    </div>
  );
}
