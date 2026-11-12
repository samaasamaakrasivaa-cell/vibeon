import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";

// Озвучка вводного теста (content/placement/audio). Имена — только id заданий: L-B1-02, S-A1-01-q1.
const DIR = path.join(process.cwd(), "content", "placement", "audio");

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const name = (await params).name;
  if (!/^T?[LS]-[ABC][12]-\d{2}(-q\d)?\.mp3$/.test(name)) return new NextResponse("Not found", { status: 404 });
  const buf = await readFile(path.join(DIR, name)).catch(() => null);
  if (!buf) return new NextResponse("Not found", { status: 404 });
  const base = { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400", "Accept-Ranges": "bytes" };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (m) {
    const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
    return new NextResponse(new Uint8Array(buf.subarray(start, end + 1)), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${buf.length}`, "Content-Length": String(end - start + 1) } });
  }
  return new NextResponse(new Uint8Array(buf), { headers: { ...base, "Content-Length": String(buf.length) } });
}
