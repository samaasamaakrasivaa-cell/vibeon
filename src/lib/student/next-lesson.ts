import "server-only";
import { db } from "../db";

const lessonCard = { id: true, startsAt: true, template: { select: { title: true } } } as const;

export function nextStudentLesson(userId: string, now: Date) {
  return db.lessonInstance.findFirst({
    where: { student: { userId }, status: "PLANNED", startsAt: { gt: now } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: lessonCard,
  });
}

export async function currentStudentLesson(userId: string, now: Date) {
  const windowStart = new Date(now.getTime() - 90 * 60_000);
  const lastFinished = await db.lessonInstance.findFirst({
    where: { student: { userId }, status: "DONE", finishedAt: { gt: windowStart, lte: now } },
    orderBy: { finishedAt: "desc" },
    select: { startsAt: true },
  });
  const after = lastFinished && lastFinished.startsAt > windowStart ? lastFinished.startsAt : windowStart;

  // Старый PLANNED не должен заслонять следующий урок после фактического завершения.
  return db.lessonInstance.findFirst({
    where: {
      student: { userId }, status: "PLANNED",
      startsAt: { gt: after, lte: now },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: lessonCard,
  });
}
