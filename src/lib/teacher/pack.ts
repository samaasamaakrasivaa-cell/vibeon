import "server-only";
import { db } from "../db";

/** Когда абонемент примерно закончится: дата урока, на котором спишется последнее оставшееся занятие (по расписанию). */
export async function packEndsAt(studentId: string, left: number): Promise<Date | null> {
  if (left <= 0) return null;
  const next = await db.lessonInstance.findMany({ where: { studentId, isTrial: false, status: "PLANNED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: left, select: { startsAt: true } });
  return next.length >= left ? next[left - 1].startsAt : null;
}
