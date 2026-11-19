import "server-only";
import { db } from "../db";

/** Идёт ли сейчас у ученика урок по расписанию (с запасом: 5 минут до начала, 15 — после конца).
 *  Активное время в это окно — «урок», вне его — домашка и самостоятельные занятия. */
export async function inLessonNow(studentIds: string[], now = new Date()) {
  if (!studentIds.length) return false;
  const near = await db.lessonInstance.findMany({
    where: { studentId: { in: studentIds }, status: { not: "CANCELLED" }, startsAt: { lte: new Date(now.getTime() + 5 * 60000), gte: new Date(now.getTime() - 5 * 3600e3) } },
    select: { startsAt: true, durationMin: true },
  });
  return near.some((l) => now.getTime() <= l.startsAt.getTime() + (l.durationMin + 15) * 60000);
}
