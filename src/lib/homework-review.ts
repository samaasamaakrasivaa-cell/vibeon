import { TYPES, type TaskOptions, type TaskType } from "./tasks/catalog";
import { parse } from "./tasks/parse";
import { progressOf, summary } from "./tasks/progress";

type HomeworkTask = {
  id: string;
  type: string;
  content: string;
  options: unknown;
  section: string;
  hidden: boolean;
};

export type HomeworkReviewAssignment = {
  manual?: boolean;
  extraTaskIds: string[];
  removedTaskIds?: string[];
};

export function isAssignedHomeworkTask(task: HomeworkTask, hw: HomeworkReviewAssignment) {
  const options = task.options as TaskOptions | null;
  if (options?.teacherOnly || hw.removedTaskIds?.includes(task.id)) return false;
  const extra = hw.extraTaskIds.includes(task.id);
  return hw.manual !== false ? extra && !task.hidden : extra || (task.section === "homework" && !task.hidden);
}

export function canReviewHomeworkTask(type: string) {
  return !!TYPES[type as TaskType]?.teacherCheck || type === "transform" || type === "translate";
}

export function countsAsAutoCheckedHomework(type: string, status: string | undefined, hasReview: boolean) {
  if (TYPES[type as TaskType]?.teacherCheck) return false;
  return !canReviewHomeworkTask(type) || (status === "AUTO_CHECKED" && !hasReview);
}

export function homeworkTaskDone(task: Pick<HomeworkTask, "id" | "type" | "content" | "options">, payload: unknown) {
  const answer = payload && typeof payload === "object" ? payload as Record<string, unknown> : undefined;
  const steps = progressOf({ ...task, type: task.type as TaskType, options: (task.options ?? {}) as TaskOptions }, answer);
  return steps ? summary(steps).done : null;
}

export function needsHomeworkReview(task: HomeworkTask, hw: HomeworkReviewAssignment | undefined, payload: unknown, status: string | undefined, hasReview: boolean, resubmission = false) {
  return !!hw && status === "NEEDS_REVIEW" && !hasReview && canReviewHomeworkTask(task.type) &&
    isAssignedHomeworkTask(task, hw) && (resubmission ? isCompleteHomeworkResubmission(task, payload) : homeworkTaskDone(task, payload) === true);
}

export function currentHomeworkAnswers<T extends { lessonInstanceId: string; studentId: string }>(rows: T[], lessonId: string, studentId: string | null) {
  return rows.filter((row) => row.lessonInstanceId === lessonId && row.studentId === studentId);
}

type HomeworkAttemptScope = {
  lessonInstanceId: string;
  studentId: string;
};

export type HomeworkAttempt = HomeworkAttemptScope & {
  taskId: string;
  revision: number;
  payload: unknown;
  status: string;
  teacherReview: unknown;
};

type ArchivedHomeworkAttempt<Attempt extends HomeworkAttempt = HomeworkAttempt> = {
  readonly id: string;
  readonly snapshot: Attempt;
};

type HomeworkResubmissionDraft = HomeworkAttempt & { previousAttemptId: string };

function matchesHomeworkAttempt(scope: HomeworkAttemptScope, task: HomeworkTask, attempt: HomeworkAttempt) {
  return attempt.lessonInstanceId === scope.lessonInstanceId &&
    attempt.studentId === scope.studentId && attempt.taskId === task.id;
}

export function wasReturnedForRevision(review: unknown) {
  return typeof review === "object" && review !== null && "ok" in review && review.ok === false;
}

function isReturnedHomeworkAttempt(
  scope: HomeworkAttemptScope,
  task: HomeworkTask,
  assignment: HomeworkReviewAssignment,
  attempt: HomeworkAttempt,
) {
  return matchesHomeworkAttempt(scope, task, attempt) && isAssignedHomeworkTask(task, assignment) &&
    canReviewHomeworkTask(task.type) && attempt.status === "REVIEWED" && wasReturnedForRevision(attempt.teacherReview);
}

export function isCompleteHomeworkResubmission(task: HomeworkTask, payload: unknown) {
  if (task.type !== "translate" && task.type !== "transform") return homeworkTaskDone(task, payload) === true;

  // The answer form renders an input for each parsed row, including rows without an auto-check key.
  const parsed = parse(task.type, task.content);
  if (parsed.kind !== "pairsArrow" || !parsed.items.length) return false;
  if (!payload || typeof payload !== "object" || !("val" in payload)) return false;
  if (!payload.val || typeof payload.val !== "object") return false;

  const values = payload.val as Record<number, unknown>;
  return parsed.items.every((_, i) => {
    const value = values[i];
    return typeof value === "string" && value.trim().length > 0;
  });
}

/** The adapter allocates a unique archive ID for this attempt and commits the archive and draft together at the expected revision. */
export function planHomeworkResubmission<Attempt extends HomeworkAttempt>(
  scope: HomeworkAttemptScope,
  task: HomeworkTask,
  assignment: HomeworkReviewAssignment,
  reviewedAttempt: Attempt,
  archiveId: string,
) {
  if (!archiveId || !isReturnedHomeworkAttempt(scope, task, assignment, reviewedAttempt)) return null;

  const archivedAttempt: ArchivedHomeworkAttempt<Attempt> = {
    id: archiveId,
    snapshot: structuredClone(reviewedAttempt),
  };
  return {
    expectedRevision: reviewedAttempt.revision,
    archivedAttempt,
    draft: {
      lessonInstanceId: scope.lessonInstanceId,
      studentId: scope.studentId,
      taskId: task.id,
      previousAttemptId: archiveId,
      revision: reviewedAttempt.revision + 1,
      payload: {},
      status: "DRAFT" as const,
      teacherReview: null,
      shownToStudent: false,
    },
  };
}

/** Load the draft and archive from storage. The adapter commits and advances the revision only if it still matches. */
export function submitHomeworkResubmission(
  scope: HomeworkAttemptScope,
  task: HomeworkTask,
  assignment: HomeworkReviewAssignment,
  { archivedAttempt, draft }: { archivedAttempt: ArchivedHomeworkAttempt | null; draft: HomeworkResubmissionDraft },
) {
  if (!archivedAttempt || !draft.previousAttemptId || draft.previousAttemptId !== archivedAttempt.id ||
      !isReturnedHomeworkAttempt(scope, task, assignment, archivedAttempt.snapshot) ||
      !matchesHomeworkAttempt(scope, task, draft) || draft.status !== "DRAFT" || draft.teacherReview !== null ||
      !isCompleteHomeworkResubmission(task, draft.payload)) {
    return null;
  }

  return { status: "NEEDS_REVIEW" as const, expectedRevision: draft.revision };
}
