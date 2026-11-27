import Link from "next/link";
import { notFound } from "next/navigation";
import { LessonAnalysisReport } from "@/components/lessons/LessonAnalysisReport";
import { requireUser } from "@/lib/auth/session";
import { getLang } from "@/lib/i18n/server";
import { publishedLessonAnalysis } from "@/lib/lessons/analysis";

export default async function StudentLessonAnalysis({ params }: { params: Promise<{ id: string }> }) {
  const student = await requireUser("STUDENT");
  const { id } = await params;
  const [view, lang] = await Promise.all([publishedLessonAnalysis(id, student.id), getLang()]);
  if (!view) notFound();
  const ru = lang === "ru";
  return (
    <div className="page flex flex-col gap-4" style={{ maxWidth: 820 }}>
      <Link href="/student/progress" className="small">{ru ? "← Мой прогресс" : "← My progress"}</Link>
      <div>
        <h1 className="m-0">{ru ? "Итог урока" : "Lesson summary"}</h1>
        <p className="muted m-0">{view.date.toLocaleDateString(ru ? "ru-RU" : "en-GB", { dateStyle: "long", timeZone: student.timezone })}</p>
      </div>
      <LessonAnalysisReport tasks={view.tasks} practice={view.practice} focus={view.focus} lang={lang} />
    </div>
  );
}
