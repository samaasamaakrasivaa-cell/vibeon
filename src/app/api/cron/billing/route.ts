import { NextResponse, type NextRequest } from "next/server";
import { runBilling } from "@/lib/billing/engine";

export const dynamic = "force-dynamic";

/** Ручной запуск плановых задач оплат (для внешнего планировщика или проверки). Ключ — CRON_SECRET. */
export async function POST(req: NextRequest) {
  const key = process.env.CRON_SECRET;
  const dev = process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_CRON === "1";
  if (!(key && req.headers.get("x-cron-key") === key) && !dev) return NextResponse.json({ ok: false }, { status: 403 });
  await runBilling();
  return NextResponse.json({ ok: true });
}
