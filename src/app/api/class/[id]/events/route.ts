import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { classAccess } from "@/lib/live/access";
import { join, leave, online, publish, subscribe } from "@/lib/live/bus";
import type { LessonFinishedEvent } from "@/lib/live/lesson-session";

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
  const conn = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (event: string, data: unknown) => {
        if (acc.role === "student" && ["answer", "review", "retry", "reset", "word"].includes(event)) {
          const { sid, key } = data as { sid: string; key?: string };
          if (sid !== acc.own.studentId || (event === "answer" && key === "corr")) return;
        }
        if (event === "finished") {
          const { lessons } = data as LessonFinishedEvent;
          if (acc.role === "student") {
            const own = lessons.find((lesson) => lesson.id === acc.own.id);
            if (!own) return;
            data = { hasHw: own.hasHw };
          } else {
            data = { hasHw: lessons.some((lesson) => lesson.hasHw) };
          }
        }
        ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const unsub = subscribe(ch, send);
      const unsubTeacher = acc.role === "teacher" ? subscribe(`${ch}:teacher`, send) : undefined;
      join(ch, user.id, conn);
      publish(ch, "presence", { online: online(ch) });
      // раз в 20 секунд — пинг; заодно напоминаем всем, кто в классе (если чьё-то событие о входе потерялось)
      const ping = setInterval(() => {
        try { ctrl.enqueue(enc.encode(": ping\n\n")); send("presence", { online: online(ch) }); } catch { cleanup(); }
      }, 20000);
      let done = false;
      // закрыть соединение — один раз (обрыв и отмена потока приходят оба)
      cleanup = () => { if (done) return; done = true; clearInterval(ping); unsub(); unsubTeacher?.(); leave(ch, user.id, conn); publish(ch, "presence", { online: online(ch) }); };
      req.signal.addEventListener("abort", () => { cleanup(); try { ctrl.close(); } catch { /* уже закрыто */ } });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
