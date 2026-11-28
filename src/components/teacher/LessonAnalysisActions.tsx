"use client";

import { useState } from "react";
import { Submit } from "../auth/Submit";
import { focusDetails, observationFocusOptions, type ObservationFocus } from "@/lib/lessons/observation-focus";
import { PrivateLessonDictation } from "./PrivateLessonDictation";

type LessonAnalysisActionsProps = {
  lessonId: string;
  state: "draft" | "private" | "published" | null;
  hasEvidence: boolean;
  canGenerate: boolean;
  pending: boolean;
  observation: { note: string; focus: ObservationFocus | null } | null;
  observationMax: number;
  lessonTopics: ObservationFocus[];
  estimate: string;
  lang: "ru" | "en";
  generate: (formData: FormData) => Promise<void>;
  saveObservation: (formData: FormData) => Promise<void>;
  approvePrivate: (formData: FormData) => Promise<void>;
  publish: (formData: FormData) => Promise<void>;
};

const labels = {
  ru: {
    draft: "Черновик виден только вам",
    private: "Утверждён для себя",
    published: "Опубликован для ученика",
    noEvidence: "Чтобы подготовить сводку без записанных ответов, выберите, что проверить устно, и сохраните наблюдение.",
    pending: "Готовим рекомендации…",
    generate: "Сгенерировать с ИИ",
    save: "Подготовить сводку",
    approvePrivate: "Утвердить для себя",
    publish: "Показать ученику",
    observation: "Что получилось и что стоит повторить?",
    example: "Например, в устных вопросах часто пропускает does.",
    privacy: "Заметка только для вас. После публикации ученик увидит упражнение по выбранной теме.",
    focus: "Что проверить устно",
    noFocus: "Без выбора",
    saveObservation: "Сохранить наблюдение",
  },
  en: {
    draft: "Only you can see this draft",
    private: "Approved for your reference",
    published: "Shared with the student",
    noEvidence: "To prepare a summary without saved answers, choose a speaking focus and save the observation.",
    pending: "Preparing recommendations…",
    generate: "Generate with AI",
    save: "Prepare summary",
    approvePrivate: "Approve for myself",
    publish: "Share with the student",
    observation: "What went well and what needs more practice?",
    example: "For example, often leaves out does when asking questions aloud.",
    privacy: "Your note is private. After publication the student sees a practice exercise for the selected topic.",
    focus: "What to check aloud",
    noFocus: "No focus selected",
    saveObservation: "Save observation",
  },
} as const;

export function LessonAnalysisActions({
  lessonId,
  state,
  hasEvidence,
  canGenerate,
  pending,
  observation,
  observationMax,
  lessonTopics,
  estimate,
  lang,
  generate,
  saveObservation,
  approvePrivate,
  publish,
}: LessonAnalysisActionsProps) {
  const t = labels[lang];
  const [dictating, setDictating] = useState(false);
  return (
    <div id={`lesson-analysis-actions-${lessonId}`} className="flex min-w-0 flex-col gap-2">
      {state && <p className="small muted m-0" role="status">{pending ? t.pending : t[state]}</p>}
      <form action={saveObservation} className="card flex flex-col gap-3" onSubmit={(event) => { if (dictating) event.preventDefault(); }}>
        <div className="field">
          <label htmlFor="lesson-observation">{t.observation}</label>
          <PrivateLessonDictation lang={lang} initialText={observation?.note ?? ""} maxLength={observationMax}
            placeholder={t.example} onBusy={setDictating} />
          <p id="observation-privacy" className="small muted m-0">{t.privacy}</p>
        </div>
        <div className="field">
          <label htmlFor="observation-focus">{t.focus}</label>
          <select id="observation-focus" name="focus" className="select" defaultValue={observation?.focus ?? ""}>
            <option value="">{t.noFocus}</option>
            {observationFocusOptions.map(([value, details]) => <option key={value} value={value}>{details.label[lang]}</option>)}
            {lessonTopics.map((value) => <option key={value} value={value}>{focusDetails(value).label[lang]}</option>)}
          </select>
        </div>
        {state === null && canGenerate && <p className="small muted m-0 break-words">{estimate}</p>}
        <fieldset disabled={dictating} className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
          <Submit className="btn secondary sm">{t.saveObservation}</Submit>
          {state === null && (hasEvidence || observation?.focus) &&
            <Submit className="btn primary sm" formAction={generate}>{canGenerate ? t.generate : t.save}</Submit>}
        </fieldset>
        {state === null && !hasEvidence && !observation?.focus && <p className="small muted m-0">{t.noEvidence}</p>}
      </form>
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
