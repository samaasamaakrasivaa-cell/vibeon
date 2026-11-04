import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { aiCtx } from "@/lib/ai/ctx";
import { tts } from "@/lib/ai/gateway";

/** Озвучка текста (SpeechKit). 204 — серверной озвучки нет, браузер озвучит сам. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!(await rateLimit("ai-tts:" + user.id, 60))) return NextResponse.json({ error: "rate" }, { status: 429 });
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 1500) : "";
  if (!text) return NextResponse.json({ error: "text" }, { status: 400 });
  const audio = await tts(text, body.lang === "ru-RU" ? "ru-RU" : "en-US", await aiCtx(user));
  if (!audio) return new NextResponse(null, { status: 204 });
  return new NextResponse(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}
