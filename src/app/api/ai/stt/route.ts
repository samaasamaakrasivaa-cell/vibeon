import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { aiCode, aiCtx } from "@/lib/ai/ctx";
import { stt } from "@/lib/ai/gateway";
import { sttFix } from "@/lib/ai/stt-fix";

/** Распознавание речи: WAV 16 кГц моно (до 5 минут). Ответ: { text }. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!(await rateLimit("ai-stt:" + user.id, 40))) return NextResponse.json({ error: "rate" }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File) || file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "file" }, { status: 400 });
  const lang = form?.get("lang") === "ru-RU" ? "ru-RU" : "en-US";
  try {
    const ctx = await aiCtx(user);
    const text = await stt(Buffer.from(await file.arrayBuffer()), lang, ctx);
    // русская диктовка учителя: английские термины — латиницей (у учеников английская речь не трогается)
    return NextResponse.json({ text: lang === "ru-RU" && user.role === "TEACHER" ? await sttFix(text, ctx) : text });
  } catch (e) {
    return NextResponse.json({ error: aiCode(e) }, { status: 502 });
  }
}
