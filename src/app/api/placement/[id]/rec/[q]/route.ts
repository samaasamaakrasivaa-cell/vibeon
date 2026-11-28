import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { attemptFor } from "@/lib/placement/access";
import { json, stateOf } from "@/lib/placement/run";
import { syncRecordedWsAssessment, wsTeacherWriteEnabled } from "@/lib/placement/ws-teacher-write";
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
  const sp = st.items?.[st.speaking?.id ?? ""];
  const qi = Number(q);
  if (st.section !== "speaking" || sp?.type !== "speaking" || !Number.isInteger(qi) || qi < 1 || qi > sp.questions.length) return NextResponse.json({ error: "q" }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const taskId = form?.get("taskId");
  if ((wsTeacherWriteEnabled() || taskId != null) && taskId !== sp.id) return NextResponse.json({ error: "stale" }, { status: 409 });
  const file = form?.get("file");
  if (!(file instanceof File) || file.size < 200 || file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "file" }, { status: 400 });
  const mime = /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac)/.exec(file.type)?.[0] ?? "audio/webm";
  const key = await saveFile(Buffer.from(await file.arrayBuffer()), mime);
  const previous = st.speaking?.rec?.[qi];
  for (let retry = 0; retry < 3; retry++) {
    const fresh = await db.placementAttempt.findUnique({ where: { id } });
    if (!fresh || fresh.status !== "active") break;
    const state = stateOf(structuredClone(fresh.state));
    if (state.section !== "speaking" || state.speaking?.id !== sp.id || state.speaking.rec?.[qi] !== previous) break;
    if (previous) state.rerec = { ...(state.rerec ?? {}), [qi]: (state.rerec?.[qi] ?? 0) + 1 };
    state.speaking.rec = { ...state.speaking.rec, [qi]: `${key}|${mime}` };
    const review = syncRecordedWsAssessment(fresh.review, state, "speaking");
    const save = await db.placementAttempt.updateMany({
      where: {
        id, status: "active", updatedAt: fresh.updatedAt, state: { equals: json(fresh.state) }, review: { equals: json(fresh.review) },
      },
      data: { state: json(state), ...(review === fresh.review ? {} : { review: json(review) }) },
    });
    if (save.count) return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "stale" }, { status: 409 });
}

export async function GET(_req: NextRequest, { params }: P) {
  const { id, q } = await params;
  const acc = await attemptFor(id);
  if (!acc) return new NextResponse("Not found", { status: 404 });
  const st = stateOf(acc.a.state);
  // p{номер}-{вопрос} — запись из прошлого задания (до дополнительного уровнем выше/ниже)
  const pm = /^p(\d+)-(\d+)$/.exec(q);
  const rec = pm ? st.wsPrev?.[Number(pm[1])]?.rec?.[pm[2]] : st.speaking?.rec?.[q];
  if (!rec) return new NextResponse("Not found", { status: 404 });
  const [key, mime] = rec.split("|");
  const f = await readStored(key);
  if (!f) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(f.buf), { headers: { "Content-Type": mime || "audio/webm", "Content-Length": String(f.size), "Cache-Control": "private, no-store" } });
}
