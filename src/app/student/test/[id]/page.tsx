import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { TestRunner } from "@/components/roadmap/TestRunner";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import type { Stage } from "@/lib/roadmap/cefr";
import { itemsFor, publicItems, WRITING_PROMPT } from "@/lib/roadmap/testbank";
import { PlacementAnswers } from "@/components/placement/PlacementAnswers";
import { SkillBars } from "@/components/roadmap/RoadmapEditor";
import { reviewData } from "@/lib/placement/review";
import { stateOf } from "@/lib/placement/run";
import { ReportSheet } from "@/components/placement/ReportSheet";
import { PrintButton } from "@/components/placement/PrintButton";
import { resolve, type RSaved } from "@/lib/placement/report";
import { reportData } from "@/lib/placement/report-data";
import type { Skill } from "@/lib/roadmap/cefr";

export const metadata = { title: "Тест" };

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const me = await requireUser("STUDENT");
  const { id } = await params;
  const c = await db.checkpoint.findUnique({ where: { id }, include: { student: true, roadmap: true } });
  if (!c || c.student.userId !== me.id) notFound();
  // новый вводный тест: прохождение — на отдельном экране, результат — после проверки и «Показать ученику»
  const pa = c.kind === "entry" ? await db.placementAttempt.findUnique({ where: { checkpointId: c.id } }) : null;
  if (pa) {
    if (pa.status === "new" || pa.status === "active") redirect(`/placement/${pa.id}`);
    if (pa.status !== "reviewed" || !pa.showResult)
      return (
        <div className="page" style={{ maxWidth: 760 }}>
          <section className="card text-center"><h2 className="mt-0">{t("pl.checking")}</h2><p className="muted">{t("pl.checkingSub")}</p><Link className="btn primary" href="/student">{t("pl.toCabinet")}</Link></section>
        </div>
      );
    // учитель отправил отчёт в кабинет — показываем его (вариант для ученика); разбор ответов — ниже, с той же нумерацией
    const sentReport = ((pa.review ?? {}) as { report?: RSaved }).report;
    if (sentReport?.sent) {
      const st = stateOf(pa.state);
      const full = await reportData({ ...pa, student: c.student }, st);
      const r = { ...full, d: reviewData(pa.id, st, false) }; // без скриптов аудирования — их ученику открывает только учитель
      const cfg = resolve(r.input, "student", sentReport.student);
      return (
        <div className="page print" style={{ maxWidth: 900 }}>
          <div className="mb-4 flex flex-wrap items-center gap-3 noprint"><h1 className="m-0 grow">{t("pl.title")}</h1><PrintButton label={t("rp.download")} /></div>
          <ReportSheet r={r} v="student" lang={cfg.lang} on={{ ...cfg.on, answers: false }} texts={cfg.texts} />
          <div className="noprint mt-6">
            <h2 className="mb-1">{t("pl.answers")}</h2>
            <p className="small muted mt-0 mb-3">{t("pl.studentAnswersHint")}</p>
            <PlacementAnswers id={pa.id} d={reviewData(pa.id, st, false)} teacher={false} reveal={[]} />
          </div>
        </div>
      );
    }
    const res = (c.results ?? {}) as { skills?: Partial<Record<Skill, number>> };
    const comment = ((pa.review ?? {}) as { comment?: string }).comment;
    return (
      <div className="page" style={{ maxWidth: 900 }}>
        <h1 className="mb-4">{t("pl.title")}</h1>
        <section className="card mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3"><span className="lvlbig">{pa.level}</span><span className="muted">{t("pl.yourLevel")}</span></div>
          {res.skills && <SkillBars skills={res.skills} />}
          {comment && <div className="tpassage"><div className="small mb-1 font-bold">{t("pl.teacherComment")}</div>{comment}</div>}
          <Link className="btn secondary self-start" href="/student/route?tab=a">{t("ts.toRoute")}</Link>
        </section>
        <h2 className="mb-1">{t("pl.answers")}</h2>
        <p className="small muted mt-0 mb-3">{t("pl.studentAnswersHint")}</p>
        <PlacementAnswers id={pa.id} d={reviewData(pa.id, stateOf(pa.state), false)} teacher={false} reveal={[]} />
      </div>
    );
  }
  if (c.status === "done")
    return (
      <div className="page" style={{ maxWidth: 760 }}>
        <section className="card text-center"><h2 className="mt-0">{t("ts.doneTitle", { lvl: c.level ?? "—" })}</h2><p className="muted">{t("ts.doneSub")}</p><Link className="btn primary" href="/student/route?tab=a">{t("ts.toRoute")}</Link></section>
      </div>
    );
  const stages = (c.roadmap?.stages as Stage[] | undefined) ?? [];
  const items = publicItems(itemsFor(c.kind as "entry", c.kind === "entry" ? null : stages[c.stage ?? 0]?.lvl));
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1 className="mb-1">{c.kind === "entry" ? t("rm.entry") : c.kind === "final" ? t("rt.finalTest") : t("rt.sliceTest")}</h1>
      <p className="muted mt-0 mb-5">{t("ts.lead", { n: items.length + 1 })}</p>
      <TestRunner id={c.id} items={items} writing={WRITING_PROMPT} />
    </div>
  );
}
