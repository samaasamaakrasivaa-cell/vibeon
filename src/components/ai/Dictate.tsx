"use client";
// Диктовка без ограничения по времени: звук пишется в PCM 16 кГц, режется на паузах в речи (каждые ~20–28 с)
// и сразу уходит на распознавание — текст появляется по ходу, ничего не обрывается. Пока идёт запись,
// видна полоса «● Запись идёт 0:42» с индикатором громкости и кнопкой «Остановить».
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { Icon } from "../Icon";

const RATE = 16000, MIN_S = 20, MAX_S = 28, SILENT = 0.012;

function wav(pcm: Int16Array) {
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

type Language = "ru-RU" | "en-US";

async function recognize(pcm: Int16Array, lang: Language, signal: AbortSignal) {
  const fd = new FormData();
  fd.append("audio", wav(pcm), "speech.wav"); fd.append("lang", lang);
  const r = await fetch("/api/ai/stt", { method: "POST", body: fd, signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "fail");
  return String(j.text ?? "").trim();
}

type St = "idle" | "starting" | "rec" | "busy";
type Capture = {
  ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; buf: number[]; t0: number; timer: number;
};
type Attempt = { lang: Language; controller: AbortController; capture: Capture | null; queue: Promise<void> };

function stopTracks(stream?: MediaStream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function releaseCapture(capture: Capture) {
  clearInterval(capture.timer);
  capture.node.onaudioprocess = null;
  capture.node.disconnect();
  stopTracks(capture.stream);
  void capture.ctx.close().catch(() => {});
}

function discard(attempt: Attempt | null) {
  if (!attempt) return;
  attempt.controller.abort();
  if (attempt.capture) releaseCapture(attempt.capture);
  attempt.capture = null;
}

/** Кнопка «Надиктовать»: текст приходит кусками через onText (по порядку). */
export function Dictate({ onText, lang = "ru-RU", label, className = "", round, onBusy, cancelLabel, describedBy, disabled }: {
  onText: (text: string) => void;
  lang?: Language;
  label?: string;
  className?: string;
  round?: boolean;
  onBusy?: (busy: boolean) => void;
  cancelLabel?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [st, setSt] = useState<St>("idle");
  const [sec, setSec] = useState(0);
  const [lvl, setLvl] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const r = useRef<Attempt | null>(null);
  const cb = useRef(onText); cb.current = onText;
  const busyCb = useRef(onBusy); busyCb.current = onBusy;
  useEffect(() => { busyCb.current?.(st !== "idle"); }, [st]);

  const send = (x: Attempt, samples: number[]) => {
    if (r.current !== x || samples.length < RATE * 0.4) return;
    const pcm = Int16Array.from(samples, (s) => Math.max(-1, Math.min(1, s)) * 0x7fff);
    // по порядку: следующий кусок распознаётся после предыдущего, текст добавляется в том же порядке
    x.queue = x.queue.then(async () => {
      if (r.current !== x) return;
      try {
        const txt = await recognize(pcm, x.lang, x.controller.signal);
        if (r.current === x && txt) cb.current(txt);
      } catch (e) {
        if (r.current === x) setErr(t(`ai.err.${(e as Error).message}` as "ai.err.fail") || t("ai.err.fail"));
      }
    });
  };

  const start = async () => {
    if (r.current || disabled) return;
    const x: Attempt = { lang, controller: new AbortController(), capture: null, queue: Promise.resolve() };
    r.current = x;
    setErr(null);
    setSec(0);
    setSt("starting");
    let stream: MediaStream | undefined;
    let ctx: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (r.current !== x) { stopTracks(stream); return; }
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const ratio = ctx.sampleRate / RATE;
      const capture: Capture = { ctx, stream, node, buf: [], t0: Date.now(), timer: 0 };
      x.capture = capture;
      node.onaudioprocess = (e) => {
        if (r.current !== x || x.capture !== capture) return;
        const inp = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inp.length; i++) sum += inp[i] * inp[i];
        const rms = Math.sqrt(sum / inp.length);
        setLvl(Math.min(1, rms * 8));
        // понижение частоты до 16 кГц (усреднение)
        for (let pos = 0; pos < inp.length; pos += ratio) {
          const a = Math.floor(pos), b = Math.min(inp.length, Math.floor(pos + ratio));
          let s = 0; for (let i = a; i < b; i++) s += inp[i];
          capture.buf.push(b > a ? s / (b - a) : inp[a]);
        }
        const secs = capture.buf.length / RATE;
        // Keep each payload within SpeechKit's chunk size even when an audio callback crosses the boundary.
        if ((secs >= MIN_S && rms < SILENT) || secs >= MAX_S) send(x, capture.buf.splice(0, MAX_S * RATE));
      };
      src.connect(node); node.connect(ctx.destination);
      capture.timer = window.setInterval(() => setSec(Math.floor((Date.now() - capture.t0) / 1000)), 250);
      setSt("rec");
    } catch {
      if (r.current !== x) return;
      r.current = null;
      if (!x.capture) {
        stopTracks(stream);
        void ctx?.close().catch(() => {});
      }
      discard(x);
      setErr(t("dict.noMic"));
      setSt("idle");
    }
  };

  const stop = async () => {
    const x = r.current;
    if (!x?.capture) return;
    const capture = x.capture;
    x.capture = null;
    setSt("busy");
    releaseCapture(capture);
    send(x, capture.buf);
    await x.queue;
    if (r.current !== x) return;
    r.current = null; setLvl(0); setSt("idle");
  };

  const cancel = useCallback(() => {
    const x = r.current;
    r.current = null;
    discard(x);
    setErr(null);
    setLvl(0);
    setSt("idle");
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", cancel);
    return () => {
      window.removeEventListener("pagehide", cancel);
      const x = r.current;
      r.current = null;
      discard(x);
    };
  }, [cancel]);

  const mm = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  if (st === "idle" && round) return (
    <span className={`dict round ${className}`}>
      <button type="button" className="dict-mic" onClick={start} disabled={disabled} aria-describedby={describedBy} aria-label={label ?? t("dict.go")} title={label ?? t("dict.go")}><Icon name="mic" /></button>
      {err && <span className="small text-bad dict-err">{err}</span>}
    </span>
  );
  if (st === "idle") return (
    <span className={`dict ${className}`}>
      <button type="button" className="btn plain sm" onClick={start} disabled={disabled} aria-describedby={describedBy}><Icon name="mic" size="sm" />{label ?? t("dict.go")}</button>
      {err && <span className="small text-bad">{err}</span>}
    </span>
  );
  return (
    <div className={`dict-bar ${st === "rec" ? "rec" : "busy"} ${className}${cancelLabel ? " flex-wrap" : ""}`} role="status" aria-live="polite">
      {st === "rec" ? <span className="dict-dot" /> : <span className="dict-spin" />}
      <span className="dict-lbl">{st === "rec" ? t("dict.rec", { t: mm }) : st === "starting" ? t("dict.starting") : t("dict.busy")}</span>
      {st === "rec" && <span className="dict-meter" aria-hidden><span style={{ transform: `scaleX(${Math.max(0.04, lvl)})` }} /></span>}
      {st === "rec" && <button type="button" className="btn danger sm" onClick={stop}><span className="dict-sq" />{t("dict.stop")}</button>}
      {cancelLabel && <button type="button" className="btn plain sm" onClick={cancel}>{cancelLabel}</button>}
    </div>
  );
}
