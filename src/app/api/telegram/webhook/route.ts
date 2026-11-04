import { NextResponse, type NextRequest } from "next/server";
import { handleUpdate } from "@/lib/notify/bot";
import { tgEnabled, tgMock, webhookSecret } from "@/lib/notify/telegram";

/** Вебхук Telegram: проверка секрета из setWebhook, затем обработка команды. */
export async function POST(req: NextRequest) {
  if (!tgEnabled()) return NextResponse.json({ ok: false }, { status: 404 });
  const okSecret = tgMock() ? process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_CRON === "1" : req.headers.get("x-telegram-bot-api-secret-token") === webhookSecret();
  if (!okSecret) return NextResponse.json({ ok: false }, { status: 401 });
  const up = await req.json().catch(() => null);
  if (up) await handleUpdate(up).catch((e) => console.error("[telegram]", e));
  return NextResponse.json({ ok: true });
}
