import { useT } from "@/lib/i18n/client";
import { GOALS, SINCE, SKILLS } from "@/lib/onboarding";
import type { LearningAnswers } from "@/lib/student/form";

export function LearningFields({ answers }: { answers: Partial<LearningAnswers> }) {
  const { t, lang } = useT();
  const choices = (name: string, label: string, options: [string, string][], selected: string[], single = false) => (
    <fieldset className="field">
      <legend className="flabel">{label}</legend>
      <div className="chips">
        {options.map(([value, en]) => (
          <label className="chip" key={value}>
            <input type={single ? "radio" : "checkbox"} name={name} value={value} defaultChecked={selected.includes(value)} />
            <span>{lang === "en" ? en : value}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <>
      {choices("goals", t("ob.goals"), GOALS, answers.goals ?? [])}
      <div className="field"><label htmlFor="learning-other">{t("ob.other")}</label><input id="learning-other" name="other" className="input" defaultValue={answers.otherGoal} /></div>
      <div className="field"><label htmlFor="learning-about">{t("ob.about")}</label><textarea id="learning-about" name="about" className="textarea input" defaultValue={answers.about} /></div>
      {choices("since", t("ob.since"), SINCE, [answers.since ?? ""], true)}
      {choices("easy", t("ob.easy"), SKILLS, answers.easy ?? [])}
      {choices("hard", t("ob.hard"), SKILLS, answers.hard ?? [])}
      <div className="field"><label htmlFor="learning-problem">{t("ob.problem")}</label><textarea id="learning-problem" name="problem" className="textarea input" placeholder={t("ob.problemPh")} defaultValue={answers.problem} /></div>
    </>
  );
}
