import "server-only";
import { db } from "./db";
import type { Role } from "@prisma/client";

/**
 * Этап 1: пока нет входа, кабинет открывается от имени демо-пользователя из базы (prisma/seed.ts).
 * Этап 2 заменит это на пользователя из сессии и проверку роли.
 */
export async function getCurrentUser(role: Role) {
  return db.user.findFirst({ where: { role }, orderBy: { createdAt: "asc" } });
}
