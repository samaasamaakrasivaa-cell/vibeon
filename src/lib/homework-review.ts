import { TYPES, type TaskOptions, type TaskType } from "./tasks/catalog";
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

export function needsHomeworkReview(task: HomeworkTask, hw: HomeworkReviewAssignment | undefined, payload: unknown, status: string | undefined, hasReview: boolean) {
  return !!hw && status === "NEEDS_REVIEW" && !hasReview && canReviewHomeworkTask(task.type) &&
    isAssignedHomeworkTask(task, hw) && homeworkTaskDone(task, payload) === true;
}

export function currentHomeworkAnswers<T extends { lessonInstanceId: string; studentId: string }>(rows: T[], lessonId: string, studentId: string | null) {
  return rows.filter((row) => row.lessonInstanceId === lessonId && row.studentId === studentId);
}

type HomeworkAttemptScope = {
  lessonInstanceId: string;
  studentId: string;
};

type HomeworkAttempt = HomeworkAttemptScope & {
  taskId: string;
  payload: unknown;
  status: string;
  teacherReview: unknown;
};

function matchesHomeworkAttempt(scope: HomeworkAttemptScope, task: HomeworkTask, attempt: HomeworkAttempt) {
  return attempt.lessonInstanceId === scope.lessonInstanceId &&
    attempt.studentId === scope.studentId && attempt.taskId === task.id;
}

function wasReturnedForRevision(review: unknown) {
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

/** The adapter must archive this snapshot and open the draft atomically under the answer's current revision. */
export function planHomeworkResubmission<Attempt extends HomeworkAttempt>(
  scope: HomeworkAttemptScope,
  task: HomeworkTask,
  assignment: HomeworkReviewAssignment,
  reviewedAttempt: Attempt,
) {
  if (!isReturnedHomeworkAttempt(scope, task, assignment, reviewedAttempt)) return null;

  return {
    archivedAttempt: structuredClone(reviewedAttempt),
    draft: {
      lessonInstanceId: scope.lessonInstanceId,
      studentId: scope.studentId,
      taskId: task.id,
      payload: {},
      status: "DRAFT" as const,
      teacherReview: null,
      shownToStudent: false,
    },
  };
}

/** Use the current draft and its linked archive as read from trusted storage, with a revision check at commit. */
export function submitHomeworkResubmission(
  scope: HomeworkAttemptScope,
  task: HomeworkTask,
  assignment: HomeworkReviewAssignment,
  { archivedAttempt, draft }: { archivedAttempt: HomeworkAttempt | null; draft: HomeworkAttempt },
) {
  if (!archivedAttempt || !isReturnedHomeworkAttempt(scope, task, assignment, archivedAttempt) ||
      !matchesHomeworkAttempt(scope, task, draft) || draft.status !== "DRAFT" || draft.teacherReview !== null ||
      !needsHomeworkReview(task, assignment, draft.payload, "NEEDS_REVIEW", false)) {
    return null;
  }

  return { status: "NEEDS_REVIEW" as const };
}
