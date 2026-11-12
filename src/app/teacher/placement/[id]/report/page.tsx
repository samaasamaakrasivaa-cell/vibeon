import { notFound } from "next/navigation";
import { ReportBuilder } from "@/components/placement/ReportBuilder";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { draftTexts } from "@/lib/placement/report";
import { reportData } from "@/lib/placement/report-data";
import { stateOf } from "@/lib/placement/run";

export const metadata = { title: "Placement test — отчёт" };

export default async function PlacementReportPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser("TEACHER");
  const { id } = await params;
  const a = await db.placementAttempt.findUnique({ where: { id }, include: { student: true } });
  if (!a || a.teacherId !== me.id) notFound();
  const r = await reportData(a, stateOf(a.state));
  const drafts = {
    student: { ru: draftTexts(r.input, "student", "ru"), en: draftTexts(r.input, "student", "en") },
    parent: { ru: draftTexts(r.input, "parent", "ru"), en: draftTexts(r.input, "parent", "en") },
  };
  return (
    <div className="page print" style={{ maxWidth: 1200 }}>
      <ReportBuilder id={id} r={r} drafts={drafts} canSend={a.mode === "student"} back={`/teacher/placement/${id}`} />
    </div>
  );
}
