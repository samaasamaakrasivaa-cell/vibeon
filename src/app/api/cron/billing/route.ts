import { NextResponse, type NextRequest } from "next/server";
import { runBilling } from "@/lib/billing/engine";
import { runNotify } from "@/lib/notify/reminders";

export const dynamic = "force-dynamic";

/** Ручной запуск плановых задач (оплаты, отчёты, напоминания, отправка уведомлений) (для внешнего планировщика или проверки). Ключ — CRON_SECRET. */
export async function POST(req: NextRequest) {
  const key = process.env.CRON_SECRET;
  const dev = process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_CRON === "1";
  if (!(key && req.headers.get("x-cron-key") === key) && !dev) return NextResponse.json({ ok: false }, { status: 403 });
  await runBilling();
  await runNotify();
  return NextResponse.json({ ok: true });
}
