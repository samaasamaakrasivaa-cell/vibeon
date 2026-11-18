"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { replySupport, sendSupport } from "@/lib/admin/actions";
import { Icon } from "../Icon";

export type SMsg = { id: string; mine: boolean; text: string; when: string; who?: string };

/** Переписка с поддержкой: сообщения пузырями и поле ввода. Новые ответы подтягиваются сами (раз в 20 с). */
export function SupportChat({ msgs, to, empty, hadUnread = false }: { msgs: SMsg[]; to: string | null; empty: string; hadUnread?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs.length]);
  useEffect(() => { const i = setInterval(() => router.refresh(), 20000); return () => clearInterval(i); }, [router]);
  // непрочитанное отмечено на сервере — обновим счётчик в меню
  useEffect(() => { if (hadUnread) router.refresh(); }, [hadUnread, router]);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(false);
    const r = to ? await replySupport(to, text) : await sendSupport(text);
    setBusy(false);
    if (!r.ok) return setErr(true);
    setText(""); router.refresh();
  };
  return (
    <div className="spchat">
      <div className="spmsgs">
        {msgs.length === 0 && <p className="hint m-0 text-center">{empty}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`spmsg ${m.mine ? "mine" : ""}`}>
            {m.who && <span className="small font-semibold">{m.who}</span>}
            <div className="spbubble">{m.text}</div>
            <span className="small muted">{m.when}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="spinput">
        <textarea className="textarea" rows={3} value={text} maxLength={4000} placeholder={t("sp.ph")} aria-label={t("sp.ph")} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }} />
        <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={send}><Icon name="send" size="sm" />{t("sp.send")}</button>
      </div>
      {err && <div className="alert mt-2">{t("adm.err.fail")}</div>}
    </div>
  );
}
