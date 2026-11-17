import Link from "next/link";
import { Icon } from "@/components/Icon";
import { StudentsSearch } from "@/components/teacher/StudentsSearch";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { homeworkFor } from "@/lib/homework";
import { initials } from "@/lib/invite";

export const metadata = { title: "Домашка" };
export const dynamic = "force-dynamic";

export default async function TeacherHomework({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; kind?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const sp = await searchParams;
  const tab = sp.tab ?? "review";
  const kind = sp.kind === "tests" ? "tests" : "hw"; // «На проверку»: домашка или тесты
  const q = (sp.q ?? "").toLowerCase();
  const items = await homeworkFor({ teacherId: me.id });
  // у каждого ученика — последняя домашка; ученики без домашки после последнего урока — отдельно
  const latest = new Map<string, (typeof items)[number]>();
  for (const h of items) if (h.lesson.studentId && !latest.has(h.lesson.studentId)) latest.set(h.lesson.studentId, h);
  const students = await db.student.findMany({ where: { teacherId: me.id, status: "ACTIVE" }, orderBy: { name: "asc" } });
  const noHw = students.filter((s) => !latest.has(s.id));
  // последний проведённый урок — туда «+»: в классе задания отмечаются «в домашку» (материал можно выбрать там же)
  const lastDone = new Map((await db.lessonInstance.findMany({ where: { teacherId: me.id, status: "DONE", studentId: { in: noHw.map((s) => s.id) } }, orderBy: { startsAt: "desc" }, select: { id: true, studentId: true, startsAt: true, template: { select: { title: true } } } }))
    .reverse().map((l) => [l.studentId!, l]));
  const list = [...latest.values()];
  const by = { review: list.filter((h) => h.state === "review"), notdone: list.filter((h) => h.state === "notdone"), checked: list.filter((h) => h.state === "checked") };
  // placement test ученика — тоже работа на проверку: пройден — «На проверку», назначен — «Не сделано», проверен — «Проверено»
  const tests = await db.placementAttempt.findMany({ where: { teacherId: me.id, mode: "student", studentId: { not: null }, student: { status: "ACTIVE" } }, include: { student: true }, orderBy: { createdAt: "desc" }, take: 60 });
  const tState = (s: string) => (s === "submitted" ? "review" : s === "reviewed" ? "checked" : "notdone");
  const tBy = { review: tests.filter((x) => tState(x.status) === "review"), notdone: tests.filter((x) => tState(x.status) === "notdone"), checked: tests.filter((x) => tState(x.status) === "checked").slice(0, 12) };
  const tShown = kind !== "tests" ? [] : (tBy[tab as keyof typeof tBy] ?? tBy.review).filter((x) => !q || `${x.student?.name} ${x.student?.lastName}`.toLowerCase().includes(q));
  const hwReviewN = by.review.length;
  const tReviewN = tBy.review.length;
  const qs = (x: Record<string, string>) => `?${new URLSearchParams({ kind, tab, ...(q ? { q } : {}), ...x }).toString()}`;
  const shown = (kind !== "hw" || tab === "none" ? [] : by[tab as keyof typeof by] ?? by.review).filter((h) => !q || `${h.lesson.student?.name} ${h.lesson.student?.lastName}`.toLowerCase().includes(q));
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const when = (d: Date | null) => (d ? d.toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: me.timezone }) : "—");
  return (
    <div className="page">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1>{t("nav.toReview")}</h1><p className="muted mt-1 mb-0">{t("hwT.toReview", { n: hwReviewN + tReviewN })}</p></div>
        <StudentsSearch placeholder={t("stu.search")} />
      </div>
      {/* два раздела: домашка и тесты — всё, что ждёт взгляда учителя */}
      <div className="seg mb-4" role="tablist">
        <Link href={qs({ kind: "hw", tab: "review" })} role="tab" aria-selected={kind === "hw"} aria-pressed={kind === "hw"}><Icon name="inbox" size="sm" />{t("nav.homework")}{hwReviewN > 0 && <span className="count-pill ml-1">{hwReviewN}</span>}</Link>
        <Link href={qs({ kind: "tests", tab: "review" })} role="tab" aria-selected={kind === "tests"} aria-pressed={kind === "tests"}><Icon name="target" size="sm" />{t("hwT.tests")}{tReviewN > 0 && <span className="count-pill ml-1">{tReviewN}</span>}</Link>
      </div>
      <nav className="tabsbar fit mb-5">
        <Link href={qs({ tab: "review" })} aria-current={tab === "review" ? "page" : undefined}>{t("hwT.review")} {(kind === "hw" ? hwReviewN : tReviewN) > 0 && <span className="count-pill ml-1">{kind === "hw" ? hwReviewN : tReviewN}</span>}</Link>
        <Link href={qs({ tab: "notdone" })} aria-current={tab === "notdone" ? "page" : undefined}>{kind === "hw" ? t("hwT.notdone") : t("hwT.tNotDone")} · {kind === "hw" ? by.notdone.length : tBy.notdone.length}</Link>
        <Link href={qs({ tab: "checked" })} aria-current={tab === "checked" ? "page" : undefined}>{t("hwT.checked")} · {kind === "hw" ? by.checked.length : tBy.checked.length}</Link>
        {kind === "hw" && <Link href={qs({ tab: "none" })} aria-current={tab === "none" ? "page" : undefined}>{t("hwT.none")} · {noHw.length}</Link>}
      </nav>
      {kind === "hw" && tab === "none" ? (
        <div className="grid-3">
          {noHw.map((s) => {
            const last = lastDone.get(s.id);
            return (
              <div key={s.id} className="scard">
                <span className="avatar lg">{initials(s.name, s.lastName)}</span>
                <Link href={`/teacher/students/${s.id}`} className="grow min-w-0"><b className="block truncate">{[s.name, s.lastName].filter(Boolean).join(" ")}</b><span className="block truncate">{last ? t("hwT.lastLesson", { t: last.template?.title ?? last.startsAt.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: me.timezone }) }) : t("hwT.noHwSub")}</span></Link>
                {last && <Link href={`/class/${last.id}?addhw=1`} className="hwplus" title={t("hwT.add")} aria-label={t("hwT.add")}><Icon name="plus" size="sm" /></Link>}
              </div>
            );
          })}
          {noHw.length === 0 && <p className="hint">{t("hwT.empty")}</p>}
        </div>
      ) : shown.length + tShown.length === 0 ? <div className="card"><p className="hint m-0">{t("hwT.empty")}</p></div> : (
        <div className="grid-3">
          {tShown.map((x) => (
            <div key={x.id} className="hwcard">
              <div className="flex gap-3">
                <span className="avatar lg">{initials(x.student?.name, x.student?.lastName)}</span>
                <div className="min-w-0"><b className="block">{[x.student?.name, x.student?.lastName].filter(Boolean).join(" ")}</b><span className="small muted">{x.track === "teen" ? "Placement test Teens" : "Placement test"} · {x.submittedAt ? t("hwT.sent", { d: when(x.submittedAt) }) : t("hwT.testGiven", { d: when(x.createdAt) })}</span></div>
              </div>
              <div className="flex items-center gap-3">
                <span className="pill violet"><Icon name="target" size="sm" />{t("hwT.test")}</span>
                <span className="grow small muted">{x.status === "reviewed" ? (x.level ?? "") : x.status === "submitted" ? t("hwT.testDone") : x.status === "active" ? t("hwT.testActive") : t("hwT.testNew")}</span>
                <Link href={x.status === "new" || x.status === "active" ? `/teacher/students/${x.studentId}?tab=roadmap` : `/teacher/placement/${x.id}`} className={`btn sm ${x.status === "submitted" ? "primary" : "secondary"}`}>{x.status === "submitted" ? t("hwT.check") : t("prof.open")}</Link>
              </div>
            </div>
          ))}
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
