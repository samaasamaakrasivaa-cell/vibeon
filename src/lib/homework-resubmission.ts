import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { canReviewHomeworkTask, isAssignedHomeworkTask, planHomeworkResubmission, submitHomeworkResubmission, type HomeworkAttempt } from "./homework-review";

type Target = { lessonInstanceId: string; studentId: string; taskId: string; teacherId: string };
type Change = { revision: number } & (
  { type: "start" | "submit" } | { type: "save"; payload: Prisma.InputJsonObject }
);

async function loadTarget(client: Prisma.TransactionClient, target: Target) {
  const { lessonInstanceId, studentId, taskId, teacherId } = target;
  const [lesson, task, answer] = await Promise.all([
    client.lessonInstance.findFirst({ where: { id: lessonInstanceId, studentId, teacherId }, select: { templateId: true, status: true, homework: true } }),
    client.task.findUnique({ where: { id: taskId } }),
    client.answer.findUnique({ where: { lessonInstanceId_taskId_studentId: { lessonInstanceId, studentId, taskId } } }),
  ]);
  if (!lesson?.homework || !task || task.templateId !== lesson.templateId || !answer ||
      (lesson.status !== "DONE" && lesson.status !== "PLANNED") ||
      !canReviewHomeworkTask(task.type) || !isAssignedHomeworkTask(task, lesson.homework)) return null;
  return { task, answer, assignment: lesson.homework };
}

function visiblePayload(payload: unknown, teacher: boolean) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  if (teacher) return payload;
  // Manual corrections remain private until published in corrSent.
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "corr"));
}

export async function readHomeworkResubmission(target: Target, teacher: boolean) {
  const checked = await loadTarget(db, target);
  if (!checked) return null;
  const { answer } = checked;
  const archive = answer.previousHomeworkAttemptId
    ? await db.homeworkAttempt.findMany({ where: { answerId: answer.id }, orderBy: { sourceRevision: "desc" } })
    : [];
  return {
    revision: answer.homeworkRevision,
    status: answer.status,
    payload: visiblePayload(answer.payload, teacher),
    archived: archive.map(({ id, snapshot, createdAt }) => {
      const attempt = snapshot as HomeworkAttempt;
      return { id, at: createdAt, payload: visiblePayload(attempt.payload, teacher), review: attempt.teacherReview };
    }),
  };
}

/** The revision check covers other tab and process writers. Archive insertion and state advance commit together. */
export async function changeHomeworkResubmission(target: Target, change: Change) {
  try {
    return await db.$transaction(async (tx) => {
      const checked = await loadTarget(tx, target);
      if (!checked) return { status: 404 } as const;
      const { task, answer, assignment } = checked;
      if (answer.homeworkRevision !== change.revision) return { status: 409 } as const;
      const where = { id: answer.id, homeworkRevision: change.revision };
      const attempt = {
        lessonInstanceId: answer.lessonInstanceId, taskId: answer.taskId, studentId: answer.studentId,
        status: answer.status, revision: answer.homeworkRevision, payload: answer.payload,
        teacherReview: answer.teacherReview, shownToStudent: answer.shownToStudent,
      };

      let data: Prisma.AnswerUpdateManyMutationInput;
      let archive: { id: string; snapshot: Prisma.InputJsonObject } | undefined;
      if (change.type === "start") {
        const transition = planHomeworkResubmission(target, task, assignment, attempt, randomUUID());
        if (!transition) return { status: 409 } as const;
        archive = transition.archivedAttempt;
        data = {
          status: "DRAFT", payload: transition.draft.payload, teacherReview: Prisma.DbNull,
          aiDraft: Prisma.DbNull, shownToStudent: false, previousHomeworkAttemptId: transition.archivedAttempt.id,
        };
      } else {
        const previousAttemptId = answer.previousHomeworkAttemptId;
        if (!previousAttemptId || answer.status !== "DRAFT") return { status: 409 } as const;
        if (change.type === "save") {
          data = { payload: change.payload };
        } else {
          const row = await tx.homeworkAttempt.findFirst({ where: { id: previousAttemptId, answerId: answer.id } });
          const archivedAttempt = row ? { id: row.id, snapshot: row.snapshot as HomeworkAttempt } : null;
          const submission = submitHomeworkResubmission(target, task, assignment, {
            archivedAttempt, draft: { ...attempt, previousAttemptId },
          });
          if (!submission) return { status: 422 } as const;
          data = { status: submission.status };
        }
      }

      const updated = await tx.answer.updateMany({ where, data: { ...data, homeworkRevision: { increment: 1 } } });
      if (updated.count !== 1) return { status: 409 } as const;
      if (archive) await tx.homeworkAttempt.create({ data: { ...archive, answerId: answer.id, sourceRevision: change.revision } });
      return { status: 200, revision: change.revision + 1 } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { status: 409 } as const;
    throw error;
  }
}
