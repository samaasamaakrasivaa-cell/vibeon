import Link from "next/link";
import { Thread } from "@/components/Thread";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { initials } from "@/lib/invite";

export const metadata = { title: "Чат" };
export const dynamic = "force-dynamic";

export default async function TeacherChat({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const students = await db.student.findMany({
    where: { teacherId: me.id, status: "ACTIVE" },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { messages: { where: { readAt: null, senderId: { not: me.id } } } } } },
  });
  students.sort((a, b) => (b.messages[0]?.createdAt.getTime() ?? 0) - (a.messages[0]?.createdAt.getTime() ?? 0) || a.name.localeCompare(b.name));
  const sel = (await searchParams).s;
  const cur = students.find((s) => s.id === sel) ?? students[0];
  const msgs = cur ? await db.message.findMany({ where: { studentId: cur.id }, orderBy: { createdAt: "asc" }, take: 300 }) : [];
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1 className="mb-5">{t("nav.chat")}</h1>
      {students.length === 0 ? <div className="card"><p className="hint m-0">{t("inviteT.none")}</p></div> : (
        <div className="chatgrid">
          <aside className="card sm chatlist">
            {students.map((s) => (
              <Link key={s.id} href={`/teacher/chat?s=${s.id}`} className={`chatrow ${cur?.id === s.id ? "on" : ""}`}>
                <span className="avatar">{initials(s.name, s.lastName)}</span>
                <span className="grow min-w-0">
                  <b className="block truncate">{[s.name, s.lastName].filter(Boolean).join(" ")}</b>
                  <span className="small muted block truncate">{s.messages[0]?.text ?? t("msg.noMessages")}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  {s.messages[0] && <span className="small text-text3">{s.messages[0].createdAt.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: me.timezone })}</span>}
                  {s._count.messages > 0 && <span className="count-pill">{s._count.messages}</span>}
                </span>
              </Link>
            ))}
          </aside>
          {cur && (
            <section className="card">
              <div className="mb-3 flex items-center gap-3">
                <span className="avatar lg">{initials(cur.name, cur.lastName)}</span>
                <div className="grow"><b className="block">{[cur.name, cur.lastName].filter(Boolean).join(" ")}</b><span className="small muted">{cur.course ?? ""}</span></div>
                <Link href={`/teacher/students/${cur.id}`} className="btn secondary sm">{t("sch.openProfile")}</Link>
              </div>
              <Thread tz={me.timezone} key={cur.id} studentId={cur.id} me={me.id} names={{ [me.id]: me.name, ...(cur.userId ? { [cur.userId]: cur.name } : {}) }} initial={msgs.map((m) => ({ id: m.id, text: m.text, by: m.senderId, at: m.createdAt.toISOString() }))} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
