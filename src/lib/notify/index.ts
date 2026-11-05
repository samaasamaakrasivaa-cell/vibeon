import "server-only";
import { db } from "../db";
import { env } from "../env";
import { mailNotice } from "../mail";
import { catOf, settingsOf } from "./settings";
import { tgEnabled, tgSend } from "./telegram";

// Единая точка уведомлений: колокольчик в кабинете + Telegram и почта по настройкам пользователя.

export type Notice = { userId: string; kind: string; title: string; action?: string | null; link?: string | null; dedupe?: string };

/** Начало тихих часов → когда можно отправить (по времени пользователя). */
function notBefore(now: Date, tz: string, quiet: [number, number] | null) {
  if (!quiet || quiet[0] === quiet[1]) return now;
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(now)) % 24;
  const [a, b] = quiet;
  const inQuiet = a < b ? h >= a && h < b : h >= a || h < b;
  if (!inQuiet) return now;
  const wait = ((b - h + 24) % 24) * 3600e3 - (now.getUTCMinutes() * 60e3);
  return new Date(now.getTime() + Math.max(0, wait));
}

export async function notify(n: Notice) {
  if (n.dedupe && (await db.notification.findUnique({ where: { dedupe: n.dedupe } }))) return null;
  const user = await db.user.findUnique({ where: { id: n.userId } });
  if (!user) return null;
  const row = await db.notification.create({ data: { userId: n.userId, kind: n.kind, title: n.title.slice(0, 300), action: n.action ?? null, link: n.link ?? null, dedupe: n.dedupe ?? null } }).catch(() => null);
  if (!row) return null; // тот же dedupe создан параллельно
  const st = settingsOf(user.role, user.notify);
  const cat = catOf(n.kind);
  const url = n.link ? `${env.appUrl}${n.link}` : `${env.appUrl}/${user.role === "TEACHER" ? "teacher" : "student"}`;
  const when = notBefore(new Date(), user.timezone, st.quiet);
  const rows: { channel: string; to: string }[] = [];
  if (st.tg[cat] && user.telegramChatId && tgEnabled()) rows.push({ channel: "telegram", to: user.telegramChatId });
  if (st.email[cat] && user.email) rows.push({ channel: "email", to: user.email });
  if (rows.length) {
    await db.delivery.createMany({ data: rows.map((r) => ({ ...r, notificationId: row.id, userId: user.id, text: n.title, link: url, notBefore: when })) });
    void deliverPending().catch((e) => console.error("[notify]", e));
  }
  return row;
}

let busy = false;
/** Отправка накопленного: сразу после уведомления и раз в минуту (повторы — до 5 раз, с паузой). */
export async function deliverPending(now = new Date()) {
  if (busy) return;
  busy = true;
  try {
    const list = await db.delivery.findMany({ where: { status: "pending", notBefore: { lte: now }, attempts: { lt: 5 } }, orderBy: { createdAt: "asc" }, take: 50 });
    for (const d of list) {
      try {
        if (d.channel === "telegram") await tgSend(d.to, d.text, d.link ?? undefined);
        else {
          const u = await db.user.findUnique({ where: { id: d.userId }, select: { lang: true, role: true } });
          await mailNotice(d.to, d.text, d.link ?? env.appUrl, `${env.appUrl}/${u?.role === "TEACHER" ? "teacher" : "student"}/profile#notify`, u?.lang === "EN" ? "en" : "ru");
        }
        await db.delivery.update({ where: { id: d.id }, data: { status: "sent", sentAt: new Date(), attempts: { increment: 1 } } });
      } catch (e) {
        const attempts = d.attempts + 1;
        const msg = String((e as Error).message).slice(0, 300);
        // бот заблокирован или чат удалён — отвязываем Telegram, чтобы не слать впустую
        if (d.channel === "telegram" && /blocked|chat not found|deactivated/i.test(msg)) await db.user.updateMany({ where: { id: d.userId, telegramChatId: d.to }, data: { telegramChatId: null } });
        await db.delivery.update({ where: { id: d.id }, data: { attempts, error: msg, status: attempts >= 5 || /blocked|chat not found/i.test(msg) ? "failed" : "pending", notBefore: new Date(Date.now() + attempts * attempts * 60e3) } });
      }
    }
  } finally { busy = false; }
}

/**
 * Галочка «сделано» ставится сама, когда выполнено действие из уведомления:
 * ответили в чате, ответили на вопрос, проверили домашку, подтвердили оплату.
 */
export async function completeNotes(userId: string, where: { link?: string; linkStarts?: string; kind?: string[] }) {
  await db.notification.updateMany({
    where: {
      userId, doneAt: null,
      ...(where.link ? { link: where.link } : {}),
      ...(where.linkStarts ? { link: { startsWith: where.linkStarts } } : {}),
      ...(where.kind ? { kind: { in: where.kind } } : {}),
    },
    data: { doneAt: new Date(), readAt: new Date() },
  }).catch(() => undefined);
}

/** Сообщение плательщику (мама, папа) в Telegram — если он подключил бота по ссылке от учителя. */
export async function notifyPayer(studentId: string, text: string, link?: string) {
  const s = await db.student.findUnique({ where: { id: studentId }, select: { payerChatId: true } });
  if (!s?.payerChatId || !tgEnabled()) return;
  await tgSend(s.payerChatId, text, link).catch((e) => console.error("[payer tg]", (e as Error).message));
}
