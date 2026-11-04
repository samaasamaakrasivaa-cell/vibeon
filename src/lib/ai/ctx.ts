import "server-only";
import { db } from "../db";
import type { User } from "@prisma/client";
import { AiError, type Ctx } from "./gateway";

/** Чей лимит ИИ расходуется: учителя — свой, ученика — его преподавателя. */
export async function aiCtx(user: Pick<User, "id" | "role" | "name" | "lastName">): Promise<Ctx> {
  if (user.role === "TEACHER") return { userId: user.id, teacherId: user.id, names: [user.name, user.lastName] };
  const s = await db.student.findUnique({ where: { userId: user.id }, select: { teacherId: true, name: true, lastName: true } });
  return { userId: user.id, teacherId: s?.teacherId ?? null, names: [user.name, user.lastName, s?.name, s?.lastName] };
}

export const aiCode = (e: unknown) => (e instanceof AiError ? e.code : "fail");
