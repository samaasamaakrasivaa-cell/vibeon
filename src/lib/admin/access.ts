import "server-only";
import { notFound } from "next/navigation";
import type { User } from "@prisma/client";
import { requireUser } from "../auth/session";
import { isOwner } from "../placement/bank";

/** Администратор платформы: владельцы (OWNER_EMAIL) и те, кому выдан флаг isAdmin. */
export const isAdmin = (u: Pick<User, "email" | "isAdmin"> | null | undefined) => !!u && (u.isAdmin || isOwner(u.email));

/** Пускает только администратора; остальным страница «не найдена» — кабинет не светим. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) notFound();
  return user;
}
