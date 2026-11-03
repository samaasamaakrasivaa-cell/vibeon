import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readStored } from "@/lib/storage";

/** Отдача загруженных файлов. Ключи случайные и не угадываются; ссылки работают и в «Поделиться». */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  const meta = await db.upload.findUnique({ where: { path: key } });
  if (!meta) return new NextResponse("Not found", { status: 404 });
  const f = await readStored(key);
  if (!f) return new NextResponse("Not found", { status: 404 });
  const range = req.headers.get("range");
  const base = { "Content-Type": meta.mime, "Cache-Control": "private, max-age=31536000, immutable", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" };
  // Диапазоны нужны для перемотки аудио и видео
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? +m[1] : 0;
    const end = m[2] ? Math.min(+m[2], f.size - 1) : f.size - 1;
    return new NextResponse(new Uint8Array(f.buf.subarray(start, end + 1)), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${f.size}`, "Content-Length": String(end - start + 1) } });
  }
  return new NextResponse(new Uint8Array(f.buf), { headers: { ...base, "Content-Length": String(f.size) } });
}
