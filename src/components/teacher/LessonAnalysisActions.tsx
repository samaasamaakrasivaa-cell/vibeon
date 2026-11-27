import { Submit } from "../auth/Submit";

type LessonAnalysisActionsProps = {
  lessonId: string;
  state: "draft" | "private" | "published" | null;
  hasEvidence: boolean;
  canGenerate: boolean;
  pending: boolean;
  estimate: string;
  lang: "ru" | "en";
  generate: (formData: FormData) => Promise<void>;
  approvePrivate: (formData: FormData) => Promise<void>;
  publish: (formData: FormData) => Promise<void>;
};

const labels = {
  ru: {
    draft: "Черновик виден только вам",
    private: "Утверждён для себя",
    published: "Опубликован для ученика",
    noEvidence: "Для анализа пока нет данных урока.",
    pending: "Готовим рекомендации…",
    generate: "Сгенерировать с ИИ",
    save: "Подготовить сводку",
    approvePrivate: "Утвердить для себя",
    publish: "Показать ученику",
  },
  en: {
    draft: "Only you can see this draft",
    private: "Approved for your reference",
    published: "Shared with the student",
    noEvidence: "There is no lesson evidence to analyze yet.",
    pending: "Preparing recommendations…",
    generate: "Generate with AI",
    save: "Prepare summary",
    approvePrivate: "Approve for myself",
    publish: "Share with the student",
  },
} as const;

export function LessonAnalysisActions({
  lessonId,
  state,
  hasEvidence,
  canGenerate,
  pending,
  estimate,
  lang,
  generate,
  approvePrivate,
  publish,
}: LessonAnalysisActionsProps) {
  const t = labels[lang];
  return (
    <div id={`lesson-analysis-actions-${lessonId}`} className="flex min-w-0 flex-col gap-2">
      {state && <p className="small muted m-0" role="status">{pending ? t.pending : t[state]}</p>}
      {state === null && (
        !hasEvidence ? (
          <p className="small muted m-0">{t.noEvidence}</p>
        ) : (
          <form action={generate} className="flex flex-col items-start gap-2">
            {canGenerate && <p className="small muted m-0 break-words">{estimate}</p>}
            <Submit className="btn primary sm">{canGenerate ? t.generate : t.save}</Submit>
          </form>
        )
      )}
      {state === "draft" && !pending && (
        <form action={approvePrivate} className="flex flex-wrap gap-2">
          <Submit className="btn primary sm">{t.approvePrivate}</Submit>
          <Submit className="btn secondary sm" formAction={publish}>{t.publish}</Submit>
        </form>
      )}
      {state === "private" && (
        <form action={publish}>
          <Submit className="btn primary sm">{t.publish}</Submit>
        </form>
      )}
    </div>
  );
}
