import "server-only";
import { db } from "./db";

/** Действующее приглашение с данными ученика и учителя, либо null. */
export async function getValidInvite(token: string) {
  const inv = await db.invite.findUnique({
    where: { token },
    include: { student: true, teacher: { include: { user: { select: { name: true, lastName: true } } } } },
  });
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

export const initials = (a?: string | null, b?: string | null) => ((a?.[0] ?? "") + (b?.[0] ?? "")).toUpperCase();
