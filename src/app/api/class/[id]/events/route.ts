import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { classAccess } from "@/lib/live/access";
import { join, leave, online, publish, subscribe } from "@/lib/live/bus";

export const dynamic = "force-dynamic";

/** Поток событий класса (Server-Sent Events): ответы, состояние урока, доска, чат, присутствие. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) return new Response("auth", { status: 401 });
  const acc = await classAccess(id, user);
  if (!acc) return new Response("forbidden", { status: 403 });
  const ch = `class:${acc.host.id}`; // у группового занятия класс общий
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const unsub = subscribe(ch, send);
      join(ch, user.id);
      publish(ch, "presence", { online: online(ch) });
      const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { /* закрыто */ } }, 20000);
      cleanup = () => { clearInterval(ping); unsub(); leave(ch, user.id); publish(ch, "presence", { online: online(ch) }); };
      req.signal.addEventListener("abort", () => { cleanup(); try { ctrl.close(); } catch { /* уже закрыто */ } });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
