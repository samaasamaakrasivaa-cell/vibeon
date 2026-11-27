import { isType, type TaskOptions, type TaskType } from "../tasks/catalog";
import { progressOf, type Step } from "../tasks/progress";
import { TAG_SKILLS, topicOf, type TagSkill } from "../tasks/tags";

type Counts = { correct: number; incorrect: number; recorded: number; unanswered: number };
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
    const row: LessonTaskEvidence = {
      ...countSteps(steps), type: task.type, title: task.title, teacherMarked: payload.worked === true,
      activityMinutes, topicId: topic?.topic_id ?? null,
      topicName: typeof tags.topicName === "string" ? tags.topicName.trim().slice(0, 120) || null : null,
      skill,
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
