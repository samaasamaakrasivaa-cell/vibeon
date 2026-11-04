import type { NextRequest } from "next/server";
import { chatAccess } from "@/lib/student/access";
import { subscribe } from "@/lib/live/bus";

export const dynamic = "force-dynamic";

/** Новые сообщения переписки учитель ↔ ученик (Server-Sent Events). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const acc = await chatAccess(studentId);
  if (!acc) return new Response("forbidden", { status: 403 });
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(ctrl) {
      const unsub = subscribe(`chat:${studentId}`, (event, data) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)));
      const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { /* закрыто */ } }, 20000);
      cleanup = () => { clearInterval(ping); unsub(); };
      req.signal.addEventListener("abort", () => { cleanup(); try { ctrl.close(); } catch { /* уже закрыто */ } });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
