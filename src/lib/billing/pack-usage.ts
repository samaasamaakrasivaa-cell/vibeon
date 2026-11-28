import "server-only";
import type { LessonStatus, Pack, Prisma } from "@prisma/client";

/** Serialize changes that can spend or remove a student's paid pack. */
export async function lockStudentBilling(tx: Prisma.TransactionClient, studentId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`;
  return rows.length === 1;
}

/** Call with the student's billing lock held. Both updates commit together. */
export async function spendPackLesson(
  tx: Prisma.TransactionClient,
  pack: Pick<Pack, "id" | "studentId">,
  lessonId: string,
  manualStatus?: LessonStatus,
) {
  const lesson = await tx.lessonInstance.updateMany({
    where: { id: lessonId, studentId: pack.studentId, deductedAt: null, billedAt: null },
    data: { deductedAt: new Date(), ...(manualStatus ? { charged: true, status: manualStatus } : {}) },
  });
  if (!lesson.count) return false;

  const changed = await tx.pack.updateMany({
    where: { id: pack.id, studentId: pack.studentId, lessonsLeft: { gt: 0 } },
    data: { lessonsLeft: { decrement: 1 }, used: true },
  });
  if (!changed.count) throw new Error("Pack balance changed before the lesson could be deducted");
  return true;
}
