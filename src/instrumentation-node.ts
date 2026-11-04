// Плановые задачи оплат (списание уроков, счета, напоминания) — раз в минуту.
import { runBilling } from "./lib/billing/engine";

const g = globalThis as unknown as { __billing?: ReturnType<typeof setInterval> };
if (process.env.BILLING_SCHEDULER !== "off" && !g.__billing) {
  setTimeout(() => runBilling(), 15_000);
  g.__billing = setInterval(() => runBilling(), 60_000);
}
