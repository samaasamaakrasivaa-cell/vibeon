import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { allowedMime, fileUrl, MAX_UPLOAD, saveFile } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";

/** Загрузка файла (картинка, аудио, видео, PDF). Ответ: { url }. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!(await rateLimit("upload:" + user.id, 60))) return NextResponse.json({ error: "rate" }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file" }, { status: 400 });
  if (file.size > MAX_UPLOAD) return NextResponse.json({ error: "size" }, { status: 413 });
  if (!allowedMime(file.type)) return NextResponse.json({ error: "type" }, { status: 415 });
  const key = await saveFile(Buffer.from(await file.arrayBuffer()), file.type);
  await db.upload.create({ data: { ownerId: user.id, path: key, name: file.name.slice(0, 200), mime: file.type, size: file.size } });
  return NextResponse.json({ url: fileUrl(key), name: file.name });
}
