import "server-only";
import { createHash } from "node:crypto";
import { env } from "../env";

// Telegram-бот. Включается, когда в .env есть TELEGRAM_BOT_TOKEN.
// TELEGRAM_MOCK=1 — для разработки: сообщения не уходят в Telegram, а видны на странице /dev/telegram.

export const tgMock = () => !env.telegramBot && process.env.TELEGRAM_MOCK === "1";
export const tgEnabled = () => !!env.telegramBot || tgMock();
export const webhookSecret = () => createHash("sha256").update(`vibeon-tg:${env.telegramBot}`).digest("hex").slice(0, 32);

type Sent = { chatId: string; text: string; url?: string; at: Date };
const g = globalThis as unknown as { __tgOutbox?: Sent[]; __tgUser?: string };
export const tgOutbox = (g.__tgOutbox ??= []);

async function api<T>(method: string, body: object): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${env.telegramBot}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000),
  });
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
  return j.result as T;
}

/** Имя бота для ссылки t.me/<бот>?start=<код>. */
export async function botUsername() {
  if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "");
  if (tgMock()) return "vibeon_dev_bot";
  if (g.__tgUser) return g.__tgUser;
  const me = await api<{ username: string }>("getMe", {});
  return (g.__tgUser = me.username);
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Сообщение с кнопкой «Открыть» (кнопка — только для https-адресов: Telegram не принимает localhost). */
export async function tgSend(chatId: string, text: string, url?: string, button = "Открыть в VibeOn") {
  if (tgMock()) { tgOutbox.unshift({ chatId, text, url, at: new Date() }); tgOutbox.splice(100); return; }
  const markup = url && url.startsWith("https://") ? { inline_keyboard: [[{ text: button, url }]] } : undefined;
  await api("sendMessage", { chat_id: chatId, text: esc(text) + (url && !markup ? `\n${url}` : ""), parse_mode: "HTML", reply_markup: markup, disable_web_page_preview: true });
}

export async function tgSetWebhook() {
  if (!env.telegramBot || !env.appUrl.startsWith("https://")) return false;
  await api("setWebhook", { url: `${env.appUrl}/api/telegram/webhook`, secret_token: webhookSecret(), allowed_updates: ["message"] });
  return true;
}

export type Update = { update_id: number; message?: { chat: { id: number }; text?: string; from?: { first_name?: string } } };
export async function tgGetUpdates(offset: number) {
  return api<Update[]>("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
}
export const tgDeleteWebhook = () => api("deleteWebhook", {});
