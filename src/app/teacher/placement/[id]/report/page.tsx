import { notFound } from "next/navigation";
import { ReportBuilder } from "@/components/placement/ReportBuilder";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { draftTexts } from "@/lib/placement/report";
import { reportData } from "@/lib/placement/report-data";
import { lastPublication, publicationStamp, reportPublicationEnabled, reportSource, storedReport } from "@/lib/placement/report-publication";
import { getT } from "@/lib/i18n/server";
import { teacherReview } from "@/lib/placement/teacher-review";
import { stateOf } from "@/lib/placement/run";
import { attemptHref, resultFilter } from "@/lib/placement/results-filter";

export const metadata = { title: "Placement test — отчёт" };

export default async function PlacementReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  const { id } = await params;
  const back = attemptHref(id, resultFilter((await searchParams).status));
  const a = await db.placementAttempt.findUnique({ where: { id }, include: { student: true } });
  if (!a || a.teacherId !== me.id) notFound();
  const r = await reportData(a, stateOf(a.state));
  const stored = storedReport(a.review);
  const drafts = {
    student: { ru: draftTexts(r.input, "student", "ru"), en: draftTexts(r.input, "student", "en") },
    parent: { ru: draftTexts(r.input, "parent", "ru"), en: draftTexts(r.input, "parent", "en") },
  };
  return (
    <div className="page print" style={{ maxWidth: 1200 }}>
      {teacherReview(a).regrading && <p className="alert noprint">{t("pl.lastReportHint")}</p>}
      <ReportBuilder id={id} r={r} drafts={drafts} canSend={a.mode === "student"} source={reportSource(r, me.timezone)} timeZone={me.timezone}
        publication={publicationStamp(stored)} publicationEnabled={reportPublicationEnabled || !lastPublication(stored)}
        draftIds={stored.draftIds ?? {}} back={back} />
    </div>
  );
}
