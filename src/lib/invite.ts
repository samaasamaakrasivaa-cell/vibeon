import "server-only";
import { db } from "./db";
import { env } from "./env";
import { translate, type LangCode } from "./i18n/dict";

/** Короткая ссылка-приглашение: vibeon.online/i/k7qm2xpa9d */
export const inviteUrl = (token: string) => `${env.appUrl}/i/${token}`;
/** Короткая ссылка восстановления доступа: vibeon.online/r/… */
export const accessUrl = (code: string) => `${env.appUrl}/r/${code}`;

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

/** Готовый текст для мессенджера: имя, кто приглашает, ссылка. */
export const inviteMessage = (lang: LangCode, student: string, teacher: string, link: string) =>
  translate(lang, "inviteT.msg", { name: student, teacher, link });
