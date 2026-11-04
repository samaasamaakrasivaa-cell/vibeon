"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { partnerReply } from "@/lib/ai/actions";
import type { TaskData } from "../tasks/TaskView";
import { useSlot } from "../tasks/store";
import { Icon } from "../Icon";
import { makeRecorder, say, transcribe } from "./audio";

type Turn = { role: "user" | "assistant"; text: string };

/** ИИ-собеседник: голосом или текстом; реплики можно переслушать, скрипт — открыть. */
export function AiTalk({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options;
  const [talk, setTalk] = useSlot<Turn[]>(task.id, "talk", []);
  const [script, setScript] = useState(false);
  const [busy, setBusy] = useState<"rec" | "think" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const rec = useRef<ReturnType<typeof makeRecorder> | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!started) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [started]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [talk.length]);
  const limitSec = (o.aiMins ?? 0) * 60;
  const elapsed = started ? Math.round((now - started) / 1000) : 0;
  const over = limitSec > 0 && elapsed >= limitSec;
  const errText = (e: string) => (["limit", "tariff", "off", "fail"].includes(e) ? t(`ai.err.${e}` as "ai.err.fail") : e);

  const reply = async (hist: Turn[]) => {
    setBusy("think"); setErr(null);
    const r = await partnerReply(task.id, hist).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    setTalk([...hist, { role: "assistant", text: r.reply }]);
    void say(r.reply);
  };
  const start = () => { setStarted(Date.now()); void reply(talk); };
  const sendText = (v: string) => { const h: Turn[] = [...talk, { role: "user", text: v }]; setTalk(h); setText(""); void reply(h); };
  const mic = async () => {
    setErr(null);
    if (busy === "rec") {
      setBusy("think");
      try {
        const blob = await rec.current!.stop();
        const said = (await transcribe(blob)).trim();
        if (!said) { setBusy(null); setErr(t("ai.notHeard")); return; }
        sendText(said);
      } catch (e) { setBusy(null); setErr(errText(String((e as Error).message))); }
      return;
    }
    try { rec.current = makeRecorder(); await rec.current.start(); setBusy("rec"); }
    catch { setErr(t("tk.micError")); }
  };

  return (
    <div className="tk-ai">
      <div className="flex w-full items-center gap-3">
        <span className="tk-aiico"><Icon name="spark" size="sm" /></span><b className="grow">{t("tk.aiTalk")}</b>
        {limitSec > 0 && started && <span className={`small ${over ? "text-bad" : "muted"}`}>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} / {o.aiMins}:00</span>}
        {talk.length > 0 && <button type="button" className="btn plain sm" aria-pressed={script} onClick={() => setScript(!script)}>{script ? t("ai.hideScript") : t("ai.script")}</button>}
      </div>
      {(o.aiGoal || o.aiWords) && <div className="small muted w-full">{o.aiGoal && <div>{t("ai.goal")}: {o.aiGoal}</div>}{o.aiWords && <div>{t("ai.useWords")}: <b>{o.aiWords}</b></div>}</div>}
      {talk.length > 0 && (
        <div className="aitalk" aria-live="polite">
          {talk.map((m, i) => (
            <div key={i} className={`aimsg ${m.role === "assistant" ? "ai" : "me"}`}>
              {m.role === "assistant" && <button type="button" className="iconbtn" aria-label={t("ai.replay")} title={t("ai.replay")} onClick={() => say(m.text)}><Icon name="sound" size="sm" /></button>}
              <span>{m.role === "assistant" && !script ? <i className="muted">{t("ai.hidden")}</i> : m.text}</span>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      {talk.length === 0 ? (
        <button type="button" className="btn primary lg" disabled={!!busy} onClick={start}><Icon name="mic" />{busy ? t("ai.thinking") : t("tk.startTalk")}</button>
      ) : over ? (
        <span className="alert ok w-full">{t("ai.timeUp")}</span>
      ) : (
        <div className="flex w-full flex-col gap-2">
          <button type="button" className={`btn ${busy === "rec" ? "danger" : "primary"} lg w-full`} disabled={busy === "think"} onClick={mic}>
            {busy === "rec" ? <><span className="dot" style={{ background: "#fff" }} />{t("ai.stopSend")}</> : <><Icon name="mic" />{busy === "think" ? t("ai.thinking") : t("ai.speak")}</>}
          </button>
          <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) sendText(text.trim()); }}>
            <input className="input min-w-0 flex-1" style={{ background: "var(--surface)" }} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("ai.orType")} aria-label={t("ai.orType")} />
            <button className="btn secondary" disabled={!text.trim() || !!busy}>{t("cls.send")}</button>
          </form>
        </div>
      )}
      {err && <span className="small text-bad">{err}</span>}
    </div>
  );
}
