import Link from "next/link";
import { Icon } from "@/components/Icon";
import { StudentsSearch } from "@/components/teacher/StudentsSearch";
import { AnswerBox } from "@/components/teacher/AnswerBox";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { homeworkFor } from "@/lib/homework";
import { initials } from "@/lib/invite";

export const metadata = { title: "На проверку" };
export const dynamic = "force-dynamic";

type Kind = "hw" | "tests" | "questions";

/** «На проверку»: всё, что ждёт взгляда учителя, — три раздела (домашка, тесты, вопросы учеников).
 *  У каждого раздела свои статусы; поиск — по ученикам внутри открытого раздела. */
export default async function ToReview({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; kind?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const sp = await searchParams;
  const kind: Kind = sp.kind === "tests" ? "tests" : sp.kind === "questions" ? "questions" : "hw";
  const q = (sp.q ?? "").trim().toLowerCase();
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const when = (d: Date | null) => (d ? d.toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: me.timezone }) : "—");
  const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60000); return m < 60 ? t("nt.minAgo", { n: Math.max(1, m) }) : m < 1440 ? t("nt.hAgo", { n: Math.round(m / 60) }) : d.toLocaleDateString(loc, { day: "numeric", month: "short" }); };
  const nameOf = (s?: { name: string; lastName: string | null } | null) => [s?.name, s?.lastName].filter(Boolean).join(" ");
  const match = (s?: { name: string; lastName: string | null } | null) => !q || nameOf(s).toLowerCase().includes(q);

  // ── домашка: у каждого ученика — последняя
  const items = await homeworkFor({ teacherId: me.id });
  const latest = new Map<string, (typeof items)[number]>();
  for (const h of items) if (h.lesson.studentId && !latest.has(h.lesson.studentId)) latest.set(h.lesson.studentId, h);
  const students = await db.student.findMany({ where: { teacherId: me.id, status: "ACTIVE" }, orderBy: { name: "asc" } });
  const noHw = students.filter((s) => !latest.has(s.id));
  const lastDone = new Map((await db.lessonInstance.findMany({ where: { teacherId: me.id, status: "DONE", studentId: { in: noHw.map((s) => s.id) } }, orderBy: { startsAt: "desc" }, select: { id: true, studentId: true, startsAt: true, template: { select: { title: true } } } }))
    .reverse().map((l) => [l.studentId!, l]));
  const hwList = [...latest.values()];
  const hw = { review: hwList.filter((h) => h.state === "review"), notdone: hwList.filter((h) => h.state === "notdone"), checked: hwList.filter((h) => h.state === "checked") };
  // ── тесты учеников
  const tests = await db.placementAttempt.findMany({ where: { teacherId: me.id, mode: "student", studentId: { not: null }, student: { status: "ACTIVE" } }, include: { student: true }, orderBy: { createdAt: "desc" }, take: 80 });
  const ts = { review: tests.filter((x) => x.status === "submitted"), assigned: tests.filter((x) => x.status === "new" || x.status === "active"), checked: tests.filter((x) => x.status === "reviewed").slice(0, 20) };
  // ── вопросы учеников с уроков («Мне непонятно»)
  const qs = await db.question.findMany({ where: { student: { teacherId: me.id } }, include: { student: true, task: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 300 });
  const qg = { new: qs.filter((x) => x.askedTeacher && !x.answeredAt), answered: qs.filter((x) => x.answeredAt), ai: qs.filter((x) => !x.askedTeacher) };

  const waiting = { hw: hw.review.length, tests: ts.review.length, questions: qg.new.length };
  const filters: Record<Kind, [string, string, number][]> = {
    hw: [["review", t("rv.f.sent"), hw.review.length], ["notdone", t("hwT.notdone"), hw.notdone.length], ["checked", t("hwT.checked"), hw.checked.length], ["none", t("hwT.none"), noHw.length]],
    tests: [["review", t("rv.f.passed"), ts.review.length], ["assigned", t("rv.f.assigned"), ts.assigned.length], ["checked", t("hwT.checked"), ts.checked.length]],
    questions: [["new", t("qs.new"), qg.new.length], ["answered", t("qs.answered"), qg.answered.length], ["ai", t("qs.askedAi"), qg.ai.length]],
  };
  const tab = filters[kind].some(([k]) => k === sp.tab) ? sp.tab! : filters[kind][0][0];
  const href = (k: Kind, tb?: string) => `?${new URLSearchParams({ kind: k, ...(tb ? { tab: tb } : {}), ...(q && !tb ? { q } : {}) }).toString()}`;
  const sections: [Kind, Parameters<typeof Icon>[0]["name"], string, string][] = [
    ["hw", "inbox", t("nav.homework"), t("rv.hwSub")],
    ["tests", "target", t("hwT.tests"), t("rv.testsSub")],
    ["questions", "qmark", t("nav.questions"), t("rv.qSub")],
  ];
  const total = waiting.hw + waiting.tests + waiting.questions;

  const empty = (msg: string) => <div className="rv-empty"><span><Icon name="check" /></span><b>{msg}</b></div>;

  return (
    <div className="page">
      <div className="mb-5">
        <h1>{t("nav.toReview")}</h1>
        <p className="muted mt-1 mb-0">{total ? t("rv.lead", { n: total }) : t("rv.leadDone")}</p>
      </div>

      {/* три раздела — крупные карточки, как в «Финансах»: что внутри и сколько ждёт */}
      <div className="rv-sections" role="tablist">
        {sections.map(([k, ic, title, sub]) => (
          <Link key={k} href={href(k)} role="tab" aria-selected={kind === k} className={`rv-sec ${kind === k ? "on" : ""}`} title={`${title} — ${sub}`}>
            <span className={`rv-ico ${k}`}><Icon name={ic} /></span>
            <span className="grow min-w-0"><b className="block">{title}</b><small className="block truncate" title={sub}>{sub}</small></span>
            {waiting[k] > 0 ? <span className="rv-badge">{waiting[k]}</span> : <span className="rv-zero"><Icon name="check" size="sm" /></span>}
          </Link>
        ))}
      </div>

      {/* статусы — только у открытого раздела; поиск — по ученикам этого раздела */}
      <div className="rv-bar">
        <nav className="seg" aria-label={sections.find((s) => s[0] === kind)![2]}>
          {filters[kind].map(([k, label, n]) => (
            <Link key={k} href={`?${new URLSearchParams({ kind, tab: k, ...(q ? { q } : {}) }).toString()}`} aria-current={tab === k ? "page" : undefined} title={`${label} · ${n}`}>{label}<span className="rv-n">{n}</span></Link>
          ))}
        </nav>
        <StudentsSearch placeholder={t("rv.search")} />
      </div>

      {kind === "hw" && (tab === "none" ? (
        noHw.filter(match).length === 0 ? empty(t("rv.allHaveHw")) : (
          <div className="grid-3">
            {noHw.filter(match).map((s) => {
              const last = lastDone.get(s.id);
              return (
                <div key={s.id} className="scard">
                  <span className="avatar lg">{initials(s.name, s.lastName)}</span>
                  <Link href={`/teacher/students/${s.id}`} className="grow min-w-0"><b className="block truncate">{nameOf(s)}</b><span className="block truncate">{last ? t("hwT.lastLesson", { t: last.template?.title ?? last.startsAt.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: me.timezone }) }) : t("hwT.noHwSub")}</span></Link>
                  {last && <Link href={`/class/${last.id}?addhw=1`} className="hwplus" title={t("hwT.add")} aria-label={t("hwT.add")}><Icon name="plus" size="sm" /></Link>}
                </div>
              );
            })}
          </div>
        )
      ) : (() => {
        const list = (hw[tab as keyof typeof hw] ?? hw.review).filter((h) => match(h.lesson.student));
        return list.length === 0 ? empty(tab === "review" ? t("rv.hwNone") : t("hwT.empty")) : (
          <div className="grid-3">
            {list.map((h) => (
              <div key={h.lesson.id} className="hwcard">
                <div className="flex gap-3">
                  <span className="avatar lg">{initials(h.lesson.student?.name, h.lesson.student?.lastName)}</span>
                  <div className="min-w-0"><b className="block">{nameOf(h.lesson.student)}</b><span className="small muted">{h.title} · {h.lastAt ? t("hwT.sent", { d: when(h.lastAt) }) : t("hwT.given", { d: when(h.lesson.finishedAt) })}</span></div>
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
        );
      })())}

      {kind === "tests" && (() => {
        const list = (ts[tab as keyof typeof ts] ?? ts.review).filter((x) => match(x.student));
        return list.length === 0 ? empty(tab === "review" ? t("rv.testsNone") : t("hwT.empty")) : (
          <div className="grid-3">
            {list.map((x) => (
              <div key={x.id} className="hwcard">
                <div className="flex gap-3">
                  <span className="avatar lg">{initials(x.student?.name, x.student?.lastName)}</span>
                  <div className="min-w-0"><b className="block">{nameOf(x.student)}</b><span className="small muted">{x.track === "teen" ? "Placement test Teens" : "Placement test"} · {x.submittedAt ? t("hwT.sent", { d: when(x.submittedAt) }) : t("hwT.testGiven", { d: when(x.createdAt) })}</span></div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="grow small muted">{x.status === "reviewed" ? <b className="lvlsm">{x.level ?? "—"}</b> : x.status === "submitted" ? t("hwT.testDone") : x.status === "active" ? t("hwT.testActive") : t("hwT.testNew")}</span>
                  <Link href={x.status === "new" || x.status === "active" ? `/teacher/students/${x.studentId}?tab=roadmap` : `/teacher/placement/${x.id}`} className={`btn sm ${x.status === "submitted" ? "primary" : "secondary"}`}>{x.status === "submitted" ? t("hwT.check") : t("prof.open")}</Link>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {kind === "questions" && (() => {
        const list = (qg[tab as keyof typeof qg] ?? qg.new).filter((x) => match(x.student));
        return list.length === 0 ? empty(tab === "new" ? t("rv.qNone") : t("qs.none")) : (
          <section className="list">
            {list.map((x) => (
              <div key={x.id} className="qrow">
                <span className="avatar lg">{initials(x.student.name, x.student.lastName)}</span>
                <div className="grow">
                  <div className="flex flex-wrap items-baseline justify-between gap-2"><b>{nameOf(x.student)}</b><span className="small text-text3">{ago(x.createdAt)}</span></div>
                  {(x.context || x.task) && <div className="small muted">{x.context ?? x.task?.title}</div>}
                  <p className="mt-1 mb-0">{x.text}</p>
                  {x.aiAnswer && <div className="aianswer mt-2"><b className="small">{t("ai.says")}</b><p className="m-0 mt-1">{x.aiAnswer}</p></div>}
                  {x.teacherAnswer && <div className="alert ok mt-2">{x.teacherAnswer}</div>}
                  {!x.answeredAt && <div className="mt-2"><AnswerBox id={x.id} /></div>}
                </div>
              </div>
            ))}
          </section>
        );
      })()}
    </div>
  );
}
