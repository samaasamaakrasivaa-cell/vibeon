type HomeworkFeedbackTarget = { lessonId: string; studentId: string };

type HomeworkFeedbackAnswer = HomeworkFeedbackTarget & {
  taskId: string;
  status: string;
  payload: unknown;
  archivedPayloads: readonly unknown[];
};

type HomeworkFeedbackTask = { id: string; title: string };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function excerpt(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}

function answerTexts(payload: unknown): [string, string][] {
  const answer = object(payload);
  const fields: [string, unknown][] = [
    ["text", answer.text],
    ...Object.entries(object(answer.val)).map(([key, value]): [string, unknown] => [`row:${key}`, value]),
    ["recording", object(answer.rec).transcript],
  ];
  return fields.flatMap(([key, value]) => {
    const text = excerpt(value);
    return text ? [[key, text]] : [];
  });
}

function studentEdits(payload: unknown): [string, string][] {
  const answer = object(payload);
  const rounds: unknown[] = Array.isArray(answer.rounds) ? answer.rounds : [];
  const restarts = rounds.filter((round) => object(round).by === "student")
    .flatMap((round) => answerTexts(object(round).p));
  const fieldAttempts = Object.entries(object(answer.hist)).flatMap(([key, field]) =>
    Array.isArray(field) ? field.flatMap((entry): [string, string][] => {
      const text = excerpt(object(entry).v);
      return text ? [[`row:${key}`, text]] : [];
    }) : [],
  );
  return [...restarts, ...fieldAttempts];
}

function describe(title: string, latest: string | undefined, prior: string | undefined, lang: "ru" | "en") {
  if (lang === "ru") {
    if (prior && latest) return `«${title}» — в одной из прошлых попыток «${prior}», в последнем сданном ответе «${latest}».`;
    if (latest) return `«${title}» — в сданном ответе «${latest}».`;
    return prior ? `«${title}» — в прошлой попытке «${prior}».` : "";
  }
  if (prior && latest) return `“${title}” included “${prior}” in an earlier attempt and “${latest}” in the latest submitted answer.`;
  if (latest) return `The submitted answer for “${title}” included “${latest}”.`;
  return prior ? `An earlier attempt at “${title}” included “${prior}”.` : "";
}

/** Builds editable text from assigned tasks for one pupil. It has no side effects. */
export function draftHomeworkFeedback(
  target: HomeworkFeedbackTarget,
  assigned: readonly HomeworkFeedbackTask[],
  answers: readonly HomeworkFeedbackAnswer[],
  lang: "ru" | "en",
) {
  const ownAnswers = new Map(answers
    .filter((answer) => answer.lessonId === target.lessonId && answer.studentId === target.studentId)
    .map((answer) => [answer.taskId, answer]));
  return assigned.flatMap((task, index) => {
    const answer = ownAnswers.get(task.id);
    if (!answer) return [];
    const current = answer.status === "DRAFT" ? [] : answerTexts(answer.payload);
    const earlier = answer.archivedPayloads.flatMap(answerTexts);
    if (answer.status !== "DRAFT") earlier.push(...studentEdits(answer.payload));
    const title = excerpt(task.title) || (lang === "ru" ? `Задание ${index + 1}` : `Task ${index + 1}`);
    for (const [field, text] of current) {
      const prior = earlier.find(([key, value]) => key === field && value !== text);
      if (prior) return [describe(title, text, prior[1], lang)];
    }
    const sentence = describe(title, current[0]?.[1], current.length ? undefined : earlier[0]?.[1], lang);
    return sentence ? [sentence] : [];
  }).slice(0, 5).join("\n");
}
