import "server-only";
import { db } from "../db";
import type { User } from "@prisma/client";

/** Кто может войти в класс: учитель урока и его ученик; у группового занятия — все ученики группы.
 *  Групповое занятие — уроки учеников с общим slotId: класс у них общий (host — первый урок занятия: состояние урока, доска, канал),
 *  а ответы, домашка и слова — у каждого ученика в его уроке. */
export async function classAccess(lessonId: string, user: User) {
  const lesson = await db.lessonInstance.findUnique({ where: { id: lessonId }, include: { student: true } });
  if (!lesson) return null;
  const slot = lesson.slotId
    ? await db.lessonInstance.findMany({ where: { slotId: lesson.slotId, teacherId: lesson.teacherId }, include: { student: true }, orderBy: { id: "asc" } })
    : [lesson];
  const host = slot[0] ?? lesson;
  const group = !!lesson.slotId;
  if (user.role === "TEACHER" && lesson.teacherId === user.id) return { lesson, host, slot, group, role: "teacher" as const, own: null };
  const own = slot.find((x) => x.student?.userId === user.id);
  if (user.role === "STUDENT" && own) return { lesson: own, host, slot, group, role: "student" as const, own };
  return null;
}

export type LiveState = {
  rubricId?: string | null; spotlight?: { taskId: string; at: number } | null; hidden?: string[]; follow?: boolean;
  lockBoard?: boolean; page?: number; timer?: { endsAt: number } | null; tab?: string; scriptOpen?: string[];
  marks?: Record<string, number[]>; marksShown?: string[]; // «Выдели слова»: выделения учителя и задания, где они показаны ученику
};
