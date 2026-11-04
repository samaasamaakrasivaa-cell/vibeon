// Плановые задачи — раз в минуту: оплаты (списание уроков, счета, напоминания), недельные отчёты,
// напоминания об уроках, словах и домашке, отправка уведомлений в Telegram и на почту. Плюс Telegram-бот.
import { runBilling } from "./lib/billing/engine";
import { runNotify } from "./lib/notify/reminders";
import { startBot } from "./lib/notify/bot";

const g = globalThis as unknown as { __billing?: ReturnType<typeof setInterval> };
if (process.env.BILLING_SCHEDULER !== "off" && !g.__billing) {
  setTimeout(() => { void runBilling(); void runNotify(); }, 15_000);
  g.__billing = setInterval(() => { void runBilling(); void runNotify(); }, 60_000);
}
void startBot();
