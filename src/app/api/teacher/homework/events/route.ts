import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { subscribe, teacherReviewChannel } from "@/lib/live/bus";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response(null, { status: 401 });
  if (user.role !== "TEACHER") return new Response(null, { status: 403 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (message: string) => controller.enqueue(encoder.encode(message));
      const unsubscribe = subscribe(teacherReviewChannel(user.id), () => send("event: homeworkRevision\ndata: {}\n\n"));
      const timer = setInterval(() => send(": ping\n\n"), 20_000);
      const abort = () => { cleanup(); controller.close(); };
      cleanup = () => {
        unsubscribe();
        clearInterval(timer);
        req.signal.removeEventListener("abort", abort);
      };
      if (req.signal.aborted) abort();
      else {
        req.signal.addEventListener("abort", abort, { once: true });
        send(": connected\n\n");
      }
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "private, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
