import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { aiCode, aiCtx } from "@/lib/ai/ctx";
import { EXTRACT_MAX, extractable, extractText } from "@/lib/ai/extract";

/** «Из файла»: текст из Word / PDF / PowerPoint / фото. Файл не сохраняется. Ответ: { text, ocr }. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "TEACHER") return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!(await rateLimit("ai-extract:" + user.id, 60))) return NextResponse.json({ error: "rate" }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file" }, { status: 400 });
  if (file.size > EXTRACT_MAX) return NextResponse.json({ error: "size" }, { status: 413 });
  if (!extractable(file.name, file.type)) return NextResponse.json({ error: "type" }, { status: 415 });
  try {
    const r = await extractText(Buffer.from(await file.arrayBuffer()), file.name, file.type, await aiCtx(user));
    return NextResponse.json({ text: r.text.slice(0, 200000), ocr: r.ocr });
  } catch (e) {
    return NextResponse.json({ error: aiCode(e) }, { status: 502 });
  }
}
