import "server-only";
import { db } from "../db";
import { getSessionUser } from "../auth/session";

/** Кто участвует в переписке ученика: его учитель и сам ученик. */
export async function chatAccess(studentId: string) {
  const u = await getSessionUser();
  if (!u) return null;
  const s = await db.student.findUnique({ where: { id: studentId } });
  if (!s) return null;
  if ((u.role === "TEACHER" && s.teacherId === u.id) || (u.role === "STUDENT" && s.userId === u.id)) return { u, s };
  return null;
}
