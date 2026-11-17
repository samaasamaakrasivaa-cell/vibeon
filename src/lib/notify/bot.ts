import "server-only";
import { db } from "../db";
import { env } from "../env";
import { takeTgAvatar } from "../awards/avatar";
import { tgDeleteWebhook, tgEnabled, tgGetUpdates, tgMock, tgSend, tgSetWebhook, tgUsername, type Update } from "./telegram";

/** Команды бота: /start <код> — привязать аккаунт, /stop — отвязать, /help. */
export async function handleUpdate(u: Update) {
  const m = u.message;
  if (!m?.text) return;
  const chatId = String(m.chat.id);
  const [cmd, arg] = m.text.trim().split(/\s+/, 2);
  if (cmd === "/start" && arg?.startsWith("p_")) {
    const st = await db.student.findUnique({ where: { payerTgToken: arg.slice(2) }, include: { teacher: { select: { user: { select: { name: true, lastName: true } } } } } });
    if (!st) return tgSend(chatId, "Ссылка устарела. Попросите преподавателя прислать её ещё раз.");
    await db.student.update({ where: { id: st.id }, data: { payerChatId: chatId } });
    const teacher = [st.teacher.user.name, st.teacher.user.lastName].filter(Boolean).join(" ");
    return tgSend(chatId, `Здравствуйте${st.payerName ? ", " + st.payerName : ""}! Готово: сюда будут приходить уведомления об уроках английского ${st.name} у преподавателя ${teacher} — прошедшие уроки, отзывы и счета на оплату.\n\n/stop — отключить уведомления`);
  }
  if (cmd === "/start" && arg) {
    const user = await db.user.findUnique({ where: { tgLinkToken: arg } });
    if (!user) return tgSend(chatId, "Ссылка устарела. Откройте настройки уведомлений в VibeOn и нажмите «Подключить Telegram» ещё раз.");
    await db.user.updateMany({ where: { telegramChatId: chatId, NOT: { id: user.id } }, data: { telegramChatId: null } });
    await db.user.update({ where: { id: user.id }, data: { telegramChatId: chatId, tgLinkToken: null } });
    // ученик подключил бота — его @ник сразу попадает в анкету (если поле ещё пустое)
    if (user.role === "STUDENT" && m.from?.username) await fillTelegram(user.id, m.from.username);
    // и фото профиля — на аватарку, если ученик ещё сам ничего не выбрал (спросим «оставить или заменить»)
    if (user.role === "STUDENT") {
      const st = await db.student.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (st) await takeTgAvatar(st.id).catch((e) => console.error("[tg-avatar]", (e as Error).message));
    }
    return tgSend(chatId, `Готово, ${user.name}! Теперь уведомления VibeOn будут приходить сюда: уроки, сообщения, оплаты${user.role === "STUDENT" ? ", слова" : ""}. Настроить, что присылать: ${env.appUrl}/${user.role === "TEACHER" ? "teacher" : "student"}/profile`);
  }
  if (cmd === "/stop") {
    const n = await db.user.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } });
    const pn = await db.student.updateMany({ where: { payerChatId: chatId }, data: { payerChatId: null } });
    if (pn.count && !n.count) return tgSend(chatId, "Уведомления отключены. Подключить снова — по ссылке от преподавателя.");
    return tgSend(chatId, n.count ? "Telegram отключён — уведомления сюда больше не придут. Подключить снова можно в настройках VibeOn." : "Этот чат не привязан к VibeOn.");
  }
  return tgSend(chatId, "Это бот VibeOn — платформы для занятий английским. Чтобы получать уведомления, откройте в VibeOn «Профиль → Уведомления» и нажмите «Подключить Telegram».\n\n/stop — отключить уведомления");
}

const g = globalThis as unknown as { __tgPoll?: boolean };
/** Без https (локально) — опрос getUpdates; с https — вебхук. */
export async function startBot() {
  if (!tgEnabled() || tgMock() || g.__tgPoll) return;
  g.__tgPoll = true;
  try { if (await tgSetWebhook()) { console.log("[telegram] webhook set"); return; } } catch (e) { console.error("[telegram] webhook", e); }
  await tgDeleteWebhook().catch(() => undefined);
  let offset = 0;
  console.log("[telegram] polling");
  for (;;) {
    try {
      const ups = await tgGetUpdates(offset);
      for (const up of ups) { offset = up.update_id + 1; await handleUpdate(up).catch((e) => console.error("[telegram]", e)); }
    } catch (e) { console.error("[telegram] poll", (e as Error).message); await new Promise((r) => setTimeout(r, 5000)); }
  }
}

/** Поле «Telegram» в анкете ученика: заполняем @ником, только если учитель его ещё не вписал. */
async function fillTelegram(userId: string, username: string) {
  await db.student.updateMany({ where: { userId, OR: [{ telegram: null }, { telegram: "" }] }, data: { telegram: `@${username.replace(/^@/, "")}` } });
}

/** Ученики, подключившие бота раньше: подтянуть @ник по сохранённому чату (по несколько за раз, раз в минуту). */
export async function backfillTelegram() {
  if (!tgEnabled() || tgMock()) return;
  const xs = await db.student.findMany({ where: { OR: [{ telegram: null }, { telegram: "" }], user: { telegramChatId: { not: null } }, tgChecked: false }, select: { id: true, userId: true, user: { select: { telegramChatId: true } } }, take: 10 });
  for (const x of xs) {
    const u = x.user?.telegramChatId ? await tgUsername(x.user.telegramChatId) : null;
    if (u && x.userId) await fillTelegram(x.userId, u);
    await db.student.update({ where: { id: x.id }, data: { tgChecked: true } }); // ника нет (скрыт) — больше не спрашиваем
  }
  // фото профиля для аватарки — у подключивших бота раньше; один раз на ученика
  const ph = await db.student.findMany({ where: { tgPhotoChecked: false, avatar: null, user: { telegramChatId: { not: null } } }, select: { id: true }, take: 5 });
  for (const x of ph) await takeTgAvatar(x.id).catch(() => db.student.update({ where: { id: x.id }, data: { tgPhotoChecked: true } }));
}
