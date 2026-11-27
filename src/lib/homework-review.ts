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
