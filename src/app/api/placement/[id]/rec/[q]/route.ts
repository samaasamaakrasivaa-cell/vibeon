import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { attemptFor } from "@/lib/placement/access";
import { json, stateOf } from "@/lib/placement/run";
import type { SpeakItem } from "@/lib/placement/engine";
import { readStored, saveFile } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";

// Записи ответов на говорение. Не попадают в общие файлы (/api/files): слушать может только сам ученик и его учитель.

type P = { params: Promise<{ id: string; q: string }> };

export async function POST(req: NextRequest, { params }: P) {
  const { id, q } = await params;
  const acc = await attemptFor(id);
  if (!acc || acc.who !== "taker" || acc.a.status === "submitted" || acc.a.status === "reviewed") return NextResponse.json({ error: "auth" }, { status: 403 });
  if (!(await rateLimit("pl-rec:" + id, 30))) return NextResponse.json({ error: "rate" }, { status: 429 });
  const st = stateOf(acc.a.state);
  const sp = st.speaking ? (st.items[st.speaking.id] as SpeakItem) : null;
  const qi = Number(q);
  if (st.section !== "speaking" || !sp || !Number.isInteger(qi) || qi < 1 || qi > sp.questions.length) return NextResponse.json({ error: "q" }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size < 200 || file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "file" }, { status: 400 });
  const mime = /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac)/.exec(file.type)?.[0] ?? "audio/webm";
  const key = await saveFile(Buffer.from(await file.arrayBuffer()), mime);
  // читаем свежее состояние: записи нескольких вопросов могут прийти почти одновременно
  const fresh = await db.placementAttempt.findUnique({ where: { id } });
  const s2 = stateOf(fresh!.state);
  if (!s2.speaking) return NextResponse.json({ error: "q" }, { status: 400 });
  if (s2.speaking.rec[qi]) s2.rerec = { ...(s2.rerec ?? {}), [qi]: (s2.rerec?.[qi] ?? 0) + 1 }; // учитель видит, что ответ перезаписан
  s2.speaking.rec = { ...s2.speaking.rec, [qi]: `${key}|${mime}` };
  await db.placementAttempt.update({ where: { id }, data: { state: json(s2) } });
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: P) {
  const { id, q } = await params;
  const acc = await attemptFor(id);
  if (!acc) return new NextResponse("Not found", { status: 404 });
  const rec = stateOf(acc.a.state).speaking?.rec?.[q];
  if (!rec) return new NextResponse("Not found", { status: 404 });
  const [key, mime] = rec.split("|");
  const f = await readStored(key);
  if (!f) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(f.buf), { headers: { "Content-Type": mime || "audio/webm", "Content-Length": String(f.size), "Cache-Control": "private, no-store" } });
}
