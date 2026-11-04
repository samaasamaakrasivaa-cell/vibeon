import Link from "next/link";
import { AnswerBox } from "@/components/teacher/AnswerBox";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { initials } from "@/lib/invite";

export const metadata = { title: "Вопросы" };

export default async function Questions({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const tab = (await searchParams).tab ?? "new";
  const all = await db.question.findMany({ where: { student: { teacherId: me.id } }, include: { student: true, task: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 300 });
  const groups = {
    new: all.filter((q) => q.askedTeacher && !q.answeredAt),
    answered: all.filter((q) => q.answeredAt),
    ai: all.filter((q) => !q.askedTeacher),
  };
  const list = groups[tab as keyof typeof groups] ?? groups.new;
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60000); return m < 60 ? t("nt.minAgo", { n: Math.max(1, m) }) : m < 1440 ? t("nt.hAgo", { n: Math.round(m / 60) }) : d.toLocaleDateString(loc, { day: "numeric", month: "short" }); };
  return (
    <div className="page">
      <h1>{t("nav.questions")}</h1>
      <p className="muted mt-2 mb-5">{t("qs.lead")}</p>
      <nav className="tabsbar fit mb-5">
        <Link href="?tab=new" aria-current={tab === "new" ? "page" : undefined}>{t("qs.new")} ({groups.new.length})</Link>
        <Link href="?tab=answered" aria-current={tab === "answered" ? "page" : undefined}>{t("qs.answered")} ({groups.answered.length})</Link>
        <Link href="?tab=ai" aria-current={tab === "ai" ? "page" : undefined}>{t("qs.askedAi")} ({groups.ai.length})</Link>
      </nav>
      <section className="list">
        {list.length === 0 && <p className="hint p-5 m-0">{tab === "ai" ? t("qs.aiSoon") : t("qs.none")}</p>}
        {list.map((q) => (
          <div key={q.id} className="qrow">
            <span className="avatar lg">{initials(q.student.name, q.student.lastName)}</span>
            <div className="grow">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><b>{[q.student.name, q.student.lastName].filter(Boolean).join(" ")}</b><span className="small text-text3">{ago(q.createdAt)}</span></div>
              {(q.context || q.task) && <div className="small muted">{q.context ?? q.task?.title}</div>}
              <p className="mt-1 mb-0">{q.text}</p>
              {q.teacherAnswer && <div className="alert ok mt-2">{q.teacherAnswer}</div>}
              {!q.answeredAt && <div className="mt-2"><AnswerBox id={q.id} /></div>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
