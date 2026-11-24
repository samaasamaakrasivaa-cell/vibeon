import Link from "next/link";
import { ChatHead } from "@/components/student/SectionTabs";
import { aboutFilled, cleanAbout } from "@/lib/teacher/about-data";
import { Thread } from "@/components/Thread";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Чат" };

export default async function Messages() {
  const { t } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id }, include: { teacher: { include: { user: true } } } });
  if (!s) return null;
  const [msgs, answers] = await Promise.all([
    db.message.findMany({ where: { studentId: s.id }, orderBy: { createdAt: "asc" }, take: 300 }),
    db.notification.count({ where: { userId: me.id, kind: "answer", readAt: null } }),
  ]);
  // «Мой преподаватель» — если учитель заполнил анкету и разрешил показывать её ученикам
  const a = cleanAbout(s.teacher.about);
  const showTeacher = a.show !== false && aboutFilled(a);
  const tu = s.teacher.user;
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <ChatHead active="teacher" answers={answers} aside={showTeacher ? <Link href="/student/teacher" className="btn secondary sm">{t("nav.myTeacher")}</Link> : undefined} />
      <p className="muted mt-0 mb-4">{t("msg.withTeacher", { name: [tu.name, tu.lastName].filter(Boolean).join(" ") })}</p>
      <section className="card">
        <Thread tz={me.timezone} tgLinked={!!me.telegramChatId} studentId={s.id} me={me.id} names={{ [me.id]: me.name, [tu.id]: tu.name }} initial={msgs.map((m) => ({ id: m.id, text: m.text, by: m.senderId, at: m.createdAt.toISOString() }))} />
      </section>
    </div>
  );
}
