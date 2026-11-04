"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useT } from "@/lib/i18n/client";
import { markThreadRead, sendMessage } from "@/lib/student/actions";

export type ThreadMsg = { id: string; text: string; by: string; at: string };

/** Переписка учитель ↔ ученик: новые сообщения приходят сразу (SSE). */
export function Thread({ studentId, initial, me, names, tz }: { studentId: string; initial: ThreadMsg[]; me: string; names: Record<string, string>; tz: string }) {
  const { t, lang } = useT();
  const [msgs, setMsgs] = useState(initial);
  const [v, setV] = useState("");
  const [err, setErr] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setMsgs(initial); }, [initial]);
  useEffect(() => {
    markThreadRead(studentId);
    const es = new EventSource(`/api/chat/${studentId}/events`);
    es.addEventListener("chat", (e) => {
      const m = JSON.parse((e as MessageEvent).data) as ThreadMsg;
      setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m]));
      if (m.by !== me) markThreadRead(studentId);
    });
    return () => es.close();
  }, [studentId, me]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  let lastDay = "";
  return (
    <div className="thread">
      <div className="thread-list">
        {msgs.length === 0 && <p className="hint text-center">{t("cls.chatEmpty")}</p>}
        {msgs.map((m) => {
          const d = new Date(m.at);
          const day = d.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz });
          const sep = day !== lastDay ? <div className="thread-day">{(lastDay = day)}</div> : null;
          return (
            <div key={m.id} className="contents">
              {sep}
              <div className={`bubble ${m.by === me ? "me" : ""}`}><small>{names[m.by] ?? ""} · {d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: tz })}</small>{m.text}</div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form className="thread-form" onSubmit={async (e) => { e.preventDefault(); const text = v; if (!text.trim()) return; setV(""); const r = await sendMessage(studentId, text); setErr(!r.ok); }}>
        <textarea className="textarea" rows={2} value={v} onChange={(e) => setV(e.target.value)} placeholder={t("cls.message")} aria-label={t("cls.message")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
        <button className="btn primary" disabled={!v.trim()} aria-label={t("cls.send")}><Icon name="send" size="sm" />{t("cls.send")}</button>
      </form>
      {err && <p className="small text-bad">{t("msg.err")}</p>}
    </div>
  );
}
