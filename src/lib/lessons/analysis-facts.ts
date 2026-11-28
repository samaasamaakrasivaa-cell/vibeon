import { isType, type TaskOptions, type TaskType } from "../tasks/catalog";
import { parse } from "../tasks/parse";
import { progressOf, type Step } from "../tasks/progress";
import { TAG_SKILLS, topicOf, type TagSkill } from "../tasks/tags";

type Counts = { correct: number; incorrect: number; recorded: number; unanswered: number };
type ItemTopic = { code: string; correct: number; incorrect: number };
type PresentForm = "questions" | "negatives" | "affirmatives";
type TaskRow = {
  id: string;
  type: string;
  title: string;
  content: string;
  section: string;
  hidden?: boolean;
  options: unknown;
};
type AnswerRow = { taskId: string; payload: unknown; lessonMs: number; hwMs?: number };

export type LessonTaskEvidence = Counts & {
  type: TaskType;
  title: string;
  teacherMarked: boolean;
  activityMinutes: number | null;
  topicId: string | null;
  topicName: string | null;
  skill: TagSkill | null;
  itemTopics?: ItemTopic[];
  presentForms?: { form: PresentForm; correct: number; incorrect: number }[];
};

const emptyCounts = (): Counts => ({ correct: 0, incorrect: 0, recorded: 0, unanswered: 0 });
const countSteps = (steps: Step[] | null) => {
  const counts = emptyCounts();
  for (const step of steps ?? []) {
    if (step === "ok") counts.correct++;
    else if (step === "bad") counts.incorrect++;
    else if (step === "done") counts.recorded++;
    else counts.unanswered++;
  }
  return counts;
};

function taggedResults(steps: Step[] | null, tags: unknown) {
  if (!steps || !Array.isArray(tags) || tags.length !== steps.length) return [];
  const topics = new Map<string, ItemTopic>();
  steps.forEach((step, index) => {
    if (step !== "ok" && step !== "bad") return;
    const topic = typeof tags[index] === "string" ? topicOf(tags[index]) : null;
    if (!topic) return;
    const code = topic.topic_id;
    const counts = topics.get(code) ?? { code, correct: 0, incorrect: 0 };
    if (step === "ok") counts.correct++;
    else counts.incorrect++;
    topics.set(code, counts);
  });
  return [...topics.values()];
}

const presentTopic = "g-a1-present-simple";

function presentForm(text: string): PresentForm | null {
  const value = text.trim().toLowerCase().replace(/’/g, "'");
  if (/^(?:(?:what|when|why|where|how|who|which)\s+)?(?:do|does)\s+.+\?$/.test(value)) return "questions";
  if (value.includes("?")) return null;
  if (/\b(?:do not|does not|don't|doesn't)\s+\w/.test(value)) return "negatives";
  if (/^(?:i|you|he|she|it|we|they)\s+\w/.test(value) && !/\b(?:am|is|are|was|were|will|did|not|can|could|must|should|would)\b|'/i.test(value)) return "affirmatives";
  return null;
}

function presentForms(task: TaskRow & { type: TaskType }, steps: Step[] | null, topicId: string | null, itemTags: unknown) {
  const tags = Array.isArray(itemTags) && itemTags.length === steps?.length ? itemTags : null;
  if (!steps?.length || !(topicId === presentTopic || tags?.includes(presentTopic))) return [];
  const parsed = parse(task.type, task.content);
  let forms: (PresentForm | null)[];
  if (parsed.kind === "sentences") forms = parsed.items.map((tokens) => presentForm(tokens.join(" ")));
  else if (parsed.kind === "pairsArrow") forms = parsed.items.filter((item) => item.answers.length).map((item) => {
    const variants = item.answers.map(presentForm);
    return variants.every((form) => form === variants[0]) ? variants[0] : null;
  });
  else return [];
  if (forms.length !== steps.length) return [];
  return forms.flatMap((form, index) => {
    const step = steps[index];
    if (!form || (tags?.[index] ?? topicId) !== presentTopic || (step !== "ok" && step !== "bad")) return [];
    return [{ form, correct: Number(step === "ok"), incorrect: Number(step === "bad") }];
  });
}

export function lessonPresentForms(tasks: LessonTaskEvidence[]) {
  const totals = new Map<PresentForm, { form: PresentForm; correct: number; incorrect: number }>();
  for (const task of tasks) {
    for (const row of task.presentForms ?? []) {
      const total = totals.get(row.form) ?? { form: row.form, correct: 0, incorrect: 0 };
      total.correct += row.correct;
      total.incorrect += row.incorrect;
      totals.set(row.form, total);
    }
  }
  return [...totals.values()].sort((a, b) => b.incorrect - a.incorrect || b.correct - a.correct);
}

export function lessonItemTopics(tasks: LessonTaskEvidence[]) {
  const totals = new Map<string, ItemTopic>();
  for (const task of tasks) {
    for (const row of task.itemTopics ?? []) {
      if (!topicOf(row.code)) continue;
      const total = totals.get(row.code) ?? { code: row.code, correct: 0, incorrect: 0 };
      total.correct += row.correct;
      total.incorrect += row.incorrect;
      totals.set(row.code, total);
    }
  }
  return [...totals.values()].sort((a, b) => b.incorrect - a.incorrect || b.correct - a.correct).slice(0, 5);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const hasRecordedWork = (task: LessonTaskEvidence) =>
  task.teacherMarked || task.correct + task.incorrect + task.recorded > 0;

/** Saved evidence for this lesson's tasks. The activity estimate is kept separate from completed work. */
export function lessonTaskEvidence(tasks: TaskRow[], answers: AnswerRow[]): LessonTaskEvidence[] {
  const byTask = new Map(answers.map((answer) => [answer.taskId, answer]));
  const evidence: LessonTaskEvidence[] = [];
  for (const task of tasks) {
    if (task.section !== "lesson" || task.hidden || !isType(task.type) || task.type === "divider" || task.type === "note") continue;
    const answer = byTask.get(task.id);
    const options = asObject(task.options) as TaskOptions;
    if (!answer || options.teacherOnly) continue;
    const payload = asObject(answer.payload);
    if (!answer.lessonMs && (answer.hwMs ?? 0) > 0 && payload.worked !== true) continue;
    const tags = asObject(options.tags);
    const topic = typeof tags.topic === "string" ? topicOf(tags.topic) : null;
    const skill = TAG_SKILLS.find((value) => value === tags.skill) ?? null;
    let steps: Step[] | null = null;
    try {
      steps = progressOf({ id: task.id, type: task.type, content: task.content, options }, payload);
    } catch {
      // An old or invalid answer format cannot establish a result against the current task.
    }
    const activityMinutes = Number.isFinite(answer.lessonMs) && answer.lessonMs >= 60_000
      ? Math.round(answer.lessonMs / 60_000)
      : null;
    const itemTopics = taggedResults(steps, tags.items);
    const forms = presentForms({ ...task, type: task.type }, steps, topic?.topic_id ?? null, tags.items);
    const row: LessonTaskEvidence = {
      ...countSteps(steps), type: task.type, title: task.title, teacherMarked: payload.worked === true,
      activityMinutes, topicId: topic?.topic_id ?? null,
      topicName: typeof tags.topicName === "string" ? tags.topicName.trim().slice(0, 120) || null : null,
      skill,
      ...(itemTopics.length ? { itemTopics } : {}),
      ...(forms.length ? { presentForms: forms } : {}),
    };
    if (hasRecordedWork(row) || activityMinutes !== null) evidence.push(row);
  }
  return evidence;
}

export function lessonEvidenceTotals(tasks: LessonTaskEvidence[]) {
  const counts = emptyCounts();
  let worked = 0;
  for (const task of tasks) {
    if (!hasRecordedWork(task)) continue;
    worked++;
    counts.correct += task.correct;
    counts.incorrect += task.incorrect;
    counts.recorded += task.recorded;
    counts.unanswered += task.unanswered;
  }
  return { ...counts, worked };
}

/** Project data into an allowlist. Titles, answers, identifiers and custom tags stay in VibeOn. */
export function lessonModelEvidence(tasks: LessonTaskEvidence[]) {
  const topics = new Map<string, { code: string; tasks: number; correct: number; incorrect: number; recorded: number }>();
  for (const task of tasks) {
    if (!hasRecordedWork(task) || !task.topicId || !topicOf(task.topicId)) continue;
    const topic = topics.get(task.topicId) ?? { code: task.topicId, tasks: 0, correct: 0, incorrect: 0, recorded: 0 };
    topic.tasks++;
    topic.correct += task.correct;
    topic.incorrect += task.incorrect;
    topic.recorded += task.recorded;
    topics.set(topic.code, topic);
  }
  return [...topics.values()]
    .sort((a, b) => b.incorrect - a.incorrect || b.tasks - a.tasks || a.code.localeCompare(b.code))
    .slice(0, 12);
}
