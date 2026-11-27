"use client";

import { useActionState } from "react";
import { useT } from "@/lib/i18n/client";
import { updateMyLearningAnswers } from "@/lib/student/actions";
import type { LearningAnswers } from "@/lib/student/form";
import { LearningFields } from "./LearningFields";

export function LearningProfile({ answers }: { answers: LearningAnswers }) {
  const { t } = useT();
  const [state, action, pending] = useActionState(updateMyLearningAnswers, null);

  return (
    <section className="card scroll-mt-6" id="questionnaire">
      <h2 className="mb-2">{t("prof.startForm")}</h2>
      <p className="muted">{t("tips.form")}</p>
      <form action={action} className="flex flex-col gap-4">
        <LearningFields key={JSON.stringify(answers)} answers={answers} />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn primary" disabled={pending}>{t("common.save")}</button>
          {state?.ok && <span className="small text-ok" role="status">{t("common.saved")}</span>}
          {state?.ok === false && <span className="small text-bad" role="alert">{state.error}</span>}
        </div>
      </form>
    </section>
  );
}
