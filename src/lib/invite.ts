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

export type MsgKind = "invite" | "access" | "payer";
const DEFAULT_KEY = { invite: "inviteT.msg", access: "inviteT.accessMsg", payer: "payer.msg" } as const;

/** Свой шаблон учителя: метки {имя}, {учитель}, {ссылка}; ссылки нет в тексте — допишем в конец. */
export function renderTemplate(tpl: string, v: { name: string; teacher: string; link: string; child?: string }) {
  let s = tpl.split("{имя}").join(v.name).split("{учитель}").join(v.teacher).split("{ребёнок}").join(v.child ?? "");
  s = s.includes("{ссылка}") ? s.split("{ссылка}").join(v.link) : `${s.trim()}\n${v.link}`;
  return s;
}

/** Текст сообщения: свой шаблон учителя (если сохранён) или стандартный. */
export async function buildMessage(teacherId: string, kind: MsgKind, lang: LangCode, v: { name: string; teacher: string; link: string; child?: string }) {
  const prof = await db.teacherProfile.findUnique({ where: { userId: teacherId }, select: { settings: true } });
  const tpl = ((prof?.settings as { msgTpl?: Partial<Record<MsgKind, string>> } | null)?.msgTpl ?? {})[kind];
  return tpl ? renderTemplate(tpl, v) : translate(lang, DEFAULT_KEY[kind], { name: v.name, teacher: v.teacher, link: v.link, child: v.child ?? "" });
}
