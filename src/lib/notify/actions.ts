"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { randomToken } from "../auth/crypto";
import { botUsername, tgEnabled, tgMock, tgSend } from "./telegram";
import { CATS, LEADS, settingsOf, type NotifySettings } from "./settings";

type R = { ok: true; url?: string } | { ok: false; error: string };
const page = (role: string) => (role === "TEACHER" ? "/teacher/profile" : "/student/profile");

/** «Подключить Telegram»: одноразовый код → ссылка t.me/<бот>?start=<код>. */
export async function linkTelegram(): Promise<R> {
  const u = await requireUser();
  if (!tgEnabled()) return { ok: false, error: "off" };
  const code = randomToken(16).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  await db.user.update({ where: { id: u.id }, data: { tgLinkToken: code } });
  const url = tgMock() ? `/dev/telegram?start=${code}` : `https://t.me/${await botUsername()}?start=${code}`;
  return { ok: true, url };
}

export async function unlinkTelegram(): Promise<R> {
  const u = await requireUser();
  if (u.telegramChatId) await tgSend(u.telegramChatId, "Telegram отключён от VibeOn. Подключить снова можно в настройках уведомлений.").catch(() => undefined);
  await db.user.update({ where: { id: u.id }, data: { telegramChatId: null, tgLinkToken: null } });
  revalidatePath(page(u.role));
  return { ok: true };
}

export async function saveNotify(s: NotifySettings): Promise<R> {
  const u = await requireUser();
  const pick = (x: Partial<Record<string, boolean>>) => Object.fromEntries(CATS.map((c) => [c, !!x?.[c]]));
  const clean: NotifySettings = {
    tg: pick(s.tg), email: pick(s.email),
    lessonLead: LEADS.includes(Number(s.lessonLead)) ? Number(s.lessonLead) : settingsOf(u.role, {}).lessonLead,
    quiet: s.quiet ? [Math.abs(Math.round(s.quiet[0])) % 24, Math.abs(Math.round(s.quiet[1])) % 24] : null,
  };
  await db.user.update({ where: { id: u.id }, data: { notify: clean } });
  revalidatePath(page(u.role));
  return { ok: true };
}

/** «Проверить» — тестовое сообщение в Telegram. */
export async function testTelegram(): Promise<R> {
  const u = await requireUser();
  if (!u.telegramChatId) return { ok: false, error: "not linked" };
  try { await tgSend(u.telegramChatId, `Проверка связи: уведомления VibeOn приходят сюда 👍`); return { ok: true }; }
  catch (e) { return { ok: false, error: String((e as Error).message) }; }
}
