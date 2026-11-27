import Link from "next/link";
import { notFound } from "next/navigation";
import { LessonAnalysisReport } from "@/components/lessons/LessonAnalysisReport";
import { LessonAnalysisActions } from "@/components/teacher/LessonAnalysisActions";
import { LESSON_ANALYSIS_ESTIMATE_RUB, localPractice } from "@/lib/ai/lesson-analysis-plan";
import { requireUser } from "@/lib/auth/session";
import { getLang } from "@/lib/i18n/server";
import { analysisPending, teacherLessonAnalysis } from "@/lib/lessons/analysis";
import { approveAnalysisAction, generateAnalysisAction } from "@/lib/lessons/analysis-actions";
import { lessonModelEvidence } from "@/lib/lessons/analysis-facts";

export default async function TeacherLessonAnalysis({ params }: { params: Promise<{ id: string }> }) {
  const teacher = await requireUser("TEACHER");
  const { id } = await params;
  const [view, lang] = await Promise.all([teacherLessonAnalysis(id, teacher.id), getLang()]);
  if (!view) notFound();
  const { lesson, tasks, report, participants, canCallAi } = view;
  const ru = lang === "ru";
  const locale = ru ? "ru-RU" : "en-GB";
  const date = lesson.startsAt.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: teacher.timezone });
  const price = new Intl.NumberFormat(locale, { style: "currency", currency: "RUB" }).format(LESSON_ANALYSIS_ESTIMATE_RUB);
  const estimate = ru ? `Расход платформы — до ${price} за запрос` : `Estimated platform cost — up to ${price} per request`;
  const pending = !!report && analysisPending(report);

  return (
    <div className="page flex flex-col gap-4" style={{ maxWidth: 820 }}>
      <Link href="/teacher" className="small">{ru ? "← На главную" : "← Dashboard"}</Link>
      <div>
        <h1 className="m-0">{ru ? "Анализ урока" : "Lesson analysis"}</h1>
        <p className="muted m-0">{[lesson.student?.name, lesson.student?.lastName].filter(Boolean).join(" ")} · {date}</p>
      </div>
      {participants.length > 1 && <nav className="flex flex-wrap gap-2" aria-label={ru ? "Ученики группы" : "Group students"}>
        {participants.map((row) => <Link key={row.id} href={`/teacher/lesson-analysis/${row.id}`} aria-current={row.id === id ? "page" : undefined}
          className={`btn sm ${row.id === id ? "primary" : "secondary"}`}>
          {[row.student?.name, row.student?.lastName].filter(Boolean).join(" ")}
        </Link>)}
      </nav>}
      <LessonAnalysisReport tasks={tasks} practice={report?.practice ?? localPractice(lessonModelEvidence(tasks))} lang={lang} teacher />
      {report && !pending && <p className="small muted m-0">{report.source === "ai"
        ? (ru ? "Рекомендации подобраны ИИ по результатам урока." : "AI selected the recommendations from the lesson results.")
        : (ru ? "Рекомендации собраны по сохранённым результатам." : "Recommendations are based on the saved lesson results.")}</p>}
      <LessonAnalysisActions lessonId={id} state={report?.state ?? null} hasEvidence={tasks.length > 0} canGenerate={canCallAi}
        estimate={estimate} lang={lang} pending={pending} generate={generateAnalysisAction.bind(null, id)}
        approvePrivate={approveAnalysisAction.bind(null, id, false)} publish={approveAnalysisAction.bind(null, id, true)} />
      {pending && <Link href={`/teacher/lesson-analysis/${id}`} prefetch={false} className="small">{ru ? "Обновить отчёт" : "Refresh report"}</Link>}
    </div>
  );
}
