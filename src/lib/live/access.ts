import "server-only";
import { db } from "../db";
import type { User } from "@prisma/client";

/** Кто может войти в класс: учитель урока и его ученик. */
export async function classAccess(lessonId: string, user: User) {
  const lesson = await db.lessonInstance.findUnique({ where: { id: lessonId }, include: { student: true } });
  if (!lesson) return null;
  if (user.role === "TEACHER" && lesson.teacherId === user.id) return { lesson, role: "teacher" as const };
  if (user.role === "STUDENT" && lesson.student?.userId === user.id) return { lesson, role: "student" as const };
  return null;
}

export type LiveState = {
  rubricId?: string | null; spotlight?: { taskId: string; at: number } | null; hidden?: string[]; follow?: boolean;
  lockBoard?: boolean; page?: number; timer?: { endsAt: number } | null; tab?: string; scriptOpen?: string[];
};
