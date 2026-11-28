import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { aiCode, aiCtx } from "@/lib/ai/ctx";
import { OUTLINE_IMAGE_MAX, readCourseOutlineImage } from "@/lib/ai/course-outline-ocr";
import { isCourseOutlineImage, OUTLINE_SOURCE_LIMIT } from "@/lib/tasks/course-outline";
import { EXTRACT_MAX, extractable, extractCourseOutlineText, extractText } from "@/lib/ai/extract";

/** «Из файла»: текст из Word / PDF / PowerPoint / фото. Файл не сохраняется. Ответ: { text, ocr }. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "TEACHER") return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!(await rateLimit("ai-extract:" + user.id, 60))) return NextResponse.json({ error: "rate" }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file" }, { status: 400 });
  if (file.size > EXTRACT_MAX) return NextResponse.json({ error: "size" }, { status: 413 });
  if (form?.get("purpose") === "course-outline") {
    if (isCourseOutlineImage(file.name)) {
      if (file.size > OUTLINE_IMAGE_MAX) return NextResponse.json({ error: "outlineImageSize" }, { status: 413 });
      const result = await readCourseOutlineImage(Buffer.from(await file.arrayBuffer()));
      if ("error" in result) {
        return NextResponse.json(result, { status: result.error === "outlineBusy" ? 429 : 422 });
      }
      return NextResponse.json({ text: result.text.slice(0, OUTLINE_SOURCE_LIMIT + 1), ocr: true });
    }
    const text = await extractCourseOutlineText(Buffer.from(await file.arrayBuffer()), file.name).catch(() => "");
    if (!text.trim()) return NextResponse.json({ error: "outlineText" }, { status: 422 });
    return NextResponse.json({ text: text.slice(0, OUTLINE_SOURCE_LIMIT + 1), ocr: false });
  }
  if (!extractable(file.name, file.type)) return NextResponse.json({ error: "type" }, { status: 415 });
  try {
    const r = await extractText(Buffer.from(await file.arrayBuffer()), file.name, file.type, await aiCtx(user));
    return NextResponse.json({ text: r.text.slice(0, 200000), ocr: r.ocr });
  } catch (e) {
    return NextResponse.json({ error: aiCode(e) }, { status: 502 });
  }
}
