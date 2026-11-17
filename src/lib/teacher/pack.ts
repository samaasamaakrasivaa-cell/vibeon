import "server-only";
import { db } from "../db";

/** Когда абонемент примерно закончится: дата урока, на котором спишется последнее оставшееся занятие (по расписанию). */
export async function packEndsAt(studentId: string, left: number, frozenUntil?: Date | null): Promise<Date | null> {
  if (left <= 0) return null;
  const from = frozenUntil && frozenUntil > new Date() ? frozenUntil : new Date(); // в заморозку уроки не списываются
  const next = await db.lessonInstance.findMany({ where: { studentId, isTrial: false, status: "PLANNED", startsAt: { gt: from } }, orderBy: { startsAt: "asc" }, take: left, select: { startsAt: true } });
  return next.length >= left ? next[left - 1].startsAt : null;
}
