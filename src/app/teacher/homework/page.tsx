import Link from "next/link";
import { StudentsSearch } from "@/components/teacher/StudentsSearch";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { homeworkFor } from "@/lib/homework";
import { initials } from "@/lib/invite";

export const metadata = { title: "Домашка" };
export const dynamic = "force-dynamic";

export default async function TeacherHomework({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const sp = await searchParams;
  const tab = sp.tab ?? "review";
  const q = (sp.q ?? "").toLowerCase();
  const items = await homeworkFor({ teacherId: me.id });
  // у каждого ученика — последняя домашка; ученики без домашки после последнего урока — отдельно
  const latest = new Map<string, (typeof items)[number]>();
  for (const h of items) if (h.lesson.studentId && !latest.has(h.lesson.studentId)) latest.set(h.lesson.studentId, h);
  const students = await db.student.findMany({ where: { teacherId: me.id, status: "ACTIVE" }, orderBy: { name: "asc" } });
  const noHw = students.filter((s) => !latest.has(s.id));
  const list = [...latest.values()];
  const by = { review: list.filter((h) => h.state === "review"), notdone: list.filter((h) => h.state === "notdone"), checked: list.filter((h) => h.state === "checked") };
  const shown = (tab === "none" ? [] : by[tab as keyof typeof by] ?? by.review).filter((h) => !q || `${h.lesson.student?.name} ${h.lesson.student?.lastName}`.toLowerCase().includes(q));
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const when = (d: Date | null) => (d ? d.toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: me.timezone }) : "—");
  return (
    <div className="page">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1>{t("nav.homework")}</h1><p className="muted mt-1 mb-0">{t("hwT.toReview", { n: by.review.length })}</p></div>
        <StudentsSearch placeholder={t("stu.search")} />
      </div>
      <nav className="tabsbar fit mb-5">
        <Link href="?tab=review" aria-current={tab === "review" ? "page" : undefined}>{t("hwT.review")} {by.review.length > 0 && <span className="count-pill ml-1">{by.review.length}</span>}</Link>
        <Link href="?tab=notdone" aria-current={tab === "notdone" ? "page" : undefined}>{t("hwT.notdone")} · {by.notdone.length}</Link>
        <Link href="?tab=checked" aria-current={tab === "checked" ? "page" : undefined}>{t("hwT.checked")} · {by.checked.length}</Link>
        <Link href="?tab=none" aria-current={tab === "none" ? "page" : undefined}>{t("hwT.none")} · {noHw.length}</Link>
      </nav>
      {tab === "none" ? (
        <div className="grid-3">
          {noHw.map((s) => <Link key={s.id} href={`/teacher/students/${s.id}`} className="scard"><span className="avatar lg">{initials(s.name, s.lastName)}</span><span className="grow"><b>{[s.name, s.lastName].filter(Boolean).join(" ")}</b><span>{t("hwT.noHwSub")}</span></span></Link>)}
          {noHw.length === 0 && <p className="hint">{t("hwT.empty")}</p>}
        </div>
      ) : shown.length === 0 ? <div className="card"><p className="hint m-0">{t("hwT.empty")}</p></div> : (
        <div className="grid-3">
          {shown.map((h) => (
            <div key={h.lesson.id} className="hwcard">
              <div className="flex gap-3">
                <span className="avatar lg">{initials(h.lesson.student?.name, h.lesson.student?.lastName)}</span>
                <div className="min-w-0"><b className="block">{[h.lesson.student?.name, h.lesson.student?.lastName].filter(Boolean).join(" ")}</b><span className="small muted">{h.title} · {h.lastAt ? t("hwT.sent", { d: when(h.lastAt) }) : t("hwT.given", { d: when(h.lesson.finishedAt) })}</span></div>
              </div>
              <div className="flex items-center gap-3">
                <span className="hwbar"><i style={{ width: `${h.total ? (h.done / h.total) * 100 : 0}%` }} /></span>
                <span className="small font-semibold">{h.done}/{h.total}</span>
                <Link href={`/class/${h.lesson.id}?tab=homework`} className={`btn sm ${h.state === "review" ? "primary" : "secondary"}`}>{h.state === "review" ? t("hwT.check") : t("prof.open")}</Link>
              </div>
              {h.needs > 0 && <span className="pill orange self-start">{t("hwT.needs", { n: h.needs })}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
