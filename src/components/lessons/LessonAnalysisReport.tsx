import type { Practice } from "@/lib/ai/lesson-analysis-plan";
import { hasRecordedWork, lessonEvidenceTotals, type LessonTaskEvidence } from "@/lib/lessons/analysis-facts";
import { TYPES } from "@/lib/tasks/catalog";
import { topicLabel } from "@/lib/tasks/tags";

const labels = {
  ru: {
    work: "Что успели сделать", finished: "заданий с отметкой или ответами", correct: "верно по ключу",
    incorrect: "не совпало с ключом", recorded: "ответов без результата проверки", unanswered: "без ответа",
    marked: "Отмечено преподавателем", activityOnly: "Есть активность без результата задания",
    activity: "Больше всего активного времени", mins: "мин", repeat: "Что потренировать", next: "На следующем уроке",
    homework: "Что задать на дом", success: "Хорошо получилось", challenge: "Чаще расходилось с ключом",
    qualification: "По сохранённым ответам и отметкам. Ответы могли быть перенесены с прошлого урока или дополнены позже.",
    timeNote: "Оценка по активности браузера ученика в классе. Время вне урока сюда не входит.",
    compare: (topic: string) => `Проверить тему «${topic}» на новом примере и попросить объяснить выбор.`,
    drill: "Решить 4–6 коротких заданий и объяснить одно исправление.",
    apply: "Составить 3 свои фразы с этой темой и проверить их по образцу.",
    recall: "Вспомнить правило или слова без подсказки и привести 2 своих примера.",
    withoutTopic: "Выбрать один пункт, который вызвал затруднение, разобрать его и попробовать похожий пример.",
    consolidate: "Вспомнить одно задание без подсказки и объяснить свой ответ на похожем примере.",
  },
  en: {
    work: "What we worked on", finished: "tasks with answers or a teacher mark", correct: "matched the answer key",
    incorrect: "did not match the answer key", recorded: "answers without a check result", unanswered: "unanswered",
    marked: "Marked by the teacher", activityOnly: "Activity without a task result",
    activity: "Most recorded activity", mins: "min", repeat: "What to practise", next: "Next lesson",
    homework: "Suggested homework", success: "What went well", challenge: "Most mismatches with the answer key",
    qualification: "Based on saved answers and teacher marks. Answers may include work carried over from an earlier lesson or completed later.",
    timeNote: "Estimated from the student's browser activity in class. It excludes time recorded outside the lesson.",
    compare: (topic: string) => `Try a new example of ${topic} and explain the choice.`,
    drill: "Complete 4–6 short items and explain one correction.",
    apply: "Write 3 sentences of your own with this topic and compare them with a model.",
    recall: "Recall the rule or vocabulary without notes and give 2 examples of your own.",
    withoutTopic: "Pick an item that was difficult, review it and try a similar example.",
    consolidate: "Recall one task without notes and explain your answer to a similar example.",
  },
};

export function LessonAnalysisReport({ tasks, practice, lang, teacher = false }: {
  tasks: LessonTaskEvidence[]; practice: Practice[]; lang: "ru" | "en"; teacher?: boolean;
}) {
  if (!tasks.length) return null;
  const t = labels[lang];
  const totals = lessonEvidenceTotals(tasks);
  const work = tasks.filter(hasRecordedWork);
  const longest = [...tasks].filter((task) => task.activityMinutes !== null)
    .sort((a, b) => b.activityMinutes! - a.activityMinutes!).slice(0, teacher ? 2 : 1);
  const topic = (id: string | null, name?: string | null) => topicLabel(id ?? undefined, name ?? undefined, lang);
  const canonicalTopics = [...new Set(work.flatMap((task) => task.topicId ? [topic(task.topicId)] : []))];
  const title = (task: LessonTaskEvidence) => task.title.trim() || TYPES[task.type][lang];
  const strength = [...work].filter((task) => task.correct > 0 && !task.incorrect).sort((a, b) => b.correct - a.correct)[0];
  const challenge = [...work].filter((task) => task.incorrect > 0).sort((a, b) => b.incorrect - a.incorrect)[0];
  const highlight = (task?: LessonTaskEvidence) => task && (topic(task.topicId, teacher ? task.topicName : null) || (teacher ? title(task) : null));
  if (!totals.worked && !longest.length) return null;

  return (
    <div className="flex flex-col gap-4">
      {totals.worked > 0 && <section className="card flex flex-col gap-2">
        <h2 className="m-0">{t.work}</h2>
        <p className="m-0">{totals.worked} {t.finished}</p>
        <p className="m-0 muted small">{t.qualification}</p>
        <div className="flex flex-wrap gap-2">
          {totals.correct > 0 && <span className="pill green">{totals.correct} {t.correct}</span>}
          {totals.incorrect > 0 && <span className="pill orange">{totals.incorrect} {t.incorrect}</span>}
          {totals.recorded > 0 && <span className="pill grey">{totals.recorded} {t.recorded}</span>}
        </div>
        {highlight(strength) && <p className="small m-0"><b>{t.success}</b> · {highlight(strength)}</p>}
        {highlight(challenge) && <p className="small m-0"><b>{t.challenge}</b> · {highlight(challenge)}</p>}
        {!teacher && canonicalTopics.length > 0 && <p className="m-0 small">{canonicalTopics.join(" · ")}</p>}
        {teacher && <ul className="m-0 pl-5">
          {work.map((task, i) => <li key={i} className="mt-1">
            <b>{title(task)}</b>{topic(task.topicId, task.topicName) && ` · ${topic(task.topicId, task.topicName)}`}
            <span className="block small muted">{[
              task.correct > 0 && `${task.correct} ${t.correct}`, task.incorrect > 0 && `${task.incorrect} ${t.incorrect}`,
              task.recorded > 0 && `${task.recorded} ${t.recorded}`, task.unanswered > 0 && `${task.unanswered} ${t.unanswered}`,
              task.teacherMarked && t.marked,
            ].filter(Boolean).join(" · ")}</span>
          </li>)}
        </ul>}
      </section>}
      {longest.length > 0 && <section className="card flex flex-col gap-2">
        <h2 className="m-0">{t.activity}</h2>
        <p className="small muted m-0">{t.timeNote}</p>
        <ul className="m-0 pl-5">{longest.map((task, i) => <li key={i}>
          {teacher && <>{title(task)} · </>}≈ {task.activityMinutes} {t.mins}
          {!hasRecordedWork(task) && <span className="block small muted">{t.activityOnly}</span>}
        </li>)}</ul>
      </section>}
      {totals.worked > 0 && <section className="card flex flex-col gap-2">
        <h2 className="m-0">{teacher ? t.homework : t.repeat}</h2>
        {practice.length > 0 ? <>
          <ul className="m-0 pl-5">{practice.map((item) => <li key={item.code}><b>{topic(item.code)}</b> · {t[item.format]}</li>)}</ul>
          <p className="m-0 small"><b>{t.next}</b> · {t.compare(topic(practice[0].code))}</p>
        </> : <p className="m-0">{totals.incorrect > 0 ? t.withoutTopic : t.consolidate}</p>}
      </section>}
    </div>
  );
}
