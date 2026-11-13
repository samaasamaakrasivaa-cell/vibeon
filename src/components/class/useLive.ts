"use client";
import { useEffect, useRef, useState } from "react";

type Handler = (event: string, data: Record<string, unknown>) => void;
const EVENTS = ["answer", "live", "hw", "board", "chat", "note", "question", "review", "word", "presence", "reload", "finished", "reset"];

/** Подключение к классу: события с сервера (SSE) и отправка действий. Переподключается само. */
export function useLive(lessonId: string, onEvent: Handler) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    let es: EventSource | null = null;
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    const open = () => {
      es = new EventSource(`/api/class/${lessonId}/events`);
      es.onopen = () => setConnected(true);
      es.onerror = () => { setConnected(false); es?.close(); if (!stop) retry = setTimeout(open, 2000); };
      for (const ev of EVENTS) es.addEventListener(ev, (e) => handler.current(ev, JSON.parse((e as MessageEvent).data)));
    };
    open();
    return () => { stop = true; clearTimeout(retry); es?.close(); };
  }, [lessonId]);
  const send = (type: string, data: Record<string, unknown> = {}) =>
    fetch(`/api/class/${lessonId}/act`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, ...data }) })
      .then((r) => r.json()).catch(() => ({ ok: false }));
  return { connected, send };
}
