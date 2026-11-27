import "server-only";
import { db } from "../db";
import { callLinkOf } from "../lessons/call-link";

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

export async function studentLessonCallLink(userId: string, lessonId: string) {
  const lesson = await db.lessonInstance.findFirst({
    where: { id: lessonId, status: "PLANNED", student: { userId } },
    select: {
      teacherId: true, slotId: true, callLink: true,
      student: { select: { callLink: true } }, group: { select: { callLink: true } },
    },
  });
  if (!lesson?.teacherId) return null;
  const directLink = callLinkOf(lesson.slotId ? lesson.group?.callLink : lesson.student?.callLink, lesson.callLink);
  if (directLink) return directLink;

  const [host, teacher] = await Promise.all([
    lesson.slotId ? db.lessonInstance.findFirst({
      where: { slotId: lesson.slotId, teacherId: lesson.teacherId },
      orderBy: { id: "asc" }, select: { callLink: true },
    }) : null,
    db.teacherProfile.findUnique({ where: { userId: lesson.teacherId }, select: { callLink: true } }),
  ]);
  return callLinkOf(host?.callLink, teacher?.callLink);
}
