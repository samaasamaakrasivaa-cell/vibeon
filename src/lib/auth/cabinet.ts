import "server-only";
import type { User } from "@prisma/client";
import { db } from "../db";

// Кабинет учителя, подключённый к входу ученика (по приглашению), не имеет своих почты и пароля:
// у него служебный адрес, а входят через кабинет ученика — один логин и пароль на оба кабинета.
export const INTERNAL_DOMAIN = "cabinet.vibeon.invalid";
export const isInternalEmail = (e?: string | null) => !!e && e.endsWith(`@${INTERNAL_DOMAIN}`);
export const internalEmail = (seed: string) => `teacher-${seed}@${INTERNAL_DOMAIN}`;
/** Тестовый ученик учителя (посмотреть кабинет глазами ученика): тоже служебный адрес, вход — через кабинет учителя. */
export const demoEmail = (seed: string) => `demo-${seed}@${INTERNAL_DOMAIN}`;
export const isDemoEmail = (e?: string | null) => !!e && e.startsWith("demo-") && isInternalEmail(e);

/** Чьими почтой и паролем входят в этот кабинет: свой вход или вход привязанного кабинета. */
export async function loginOf<T extends Pick<User, "id" | "email" | "linkedUserId">>(u: T): Promise<User | T> {
  if (!isInternalEmail(u.email) || !u.linkedUserId) return u;
  const other = await db.user.findUnique({ where: { id: u.linkedUserId } });
  return other && other.linkedUserId === u.id ? other : u;
}

/** Второй кабинет того же человека, если привязка взаимная. */
export async function linkedOf(u: Pick<User, "id" | "linkedUserId">) {
  if (!u.linkedUserId) return null;
  const other = await db.user.findUnique({ where: { id: u.linkedUserId } });
  return other && other.linkedUserId === u.id ? other : null;
}
