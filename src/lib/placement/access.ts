import "server-only";
import { cookies } from "next/headers";
import { db } from "../db";
import { getSessionUser } from "../auth/session";

export const ptCookie = (id: string) => `vo_pt_${id}`;

/** Кто может проходить тест: ученик, которому его назначили; учитель («пройти самой»); человек со ссылкой (кука). */
export async function attemptFor(id: string) {
  const a = await db.placementAttempt.findUnique({ where: { id }, include: { student: true, link: true } });
  if (!a) return null;
  const user = await getSessionUser();
  if (a.mode === "student" && user && a.student?.userId === user.id) return { a, user, who: "taker" as const };
  if (a.mode === "self" && user && a.teacherId === user.id) return { a, user, who: "taker" as const };
  const tok = (await cookies()).get(ptCookie(id))?.value;
  if (a.mode === "link" && tok && tok === a.token) return { a, user, who: "taker" as const };
  if (user && user.role === "TEACHER" && a.teacherId === user.id) return { a, user, who: "teacher" as const };
  return null;
}
