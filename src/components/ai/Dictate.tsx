"use client";
// Диктовка без ограничения по времени: звук пишется в PCM 16 кГц, режется на паузах в речи (каждые ~20–28 с)
// и сразу уходит на распознавание — текст появляется по ходу, ничего не обрывается. Пока идёт запись,
// видна полоса «● Запись идёт 0:42» с индикатором громкости и кнопкой «Остановить».
import { useEffect, useRef, useState } from "react";
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

async function recognize(pcm: Int16Array, lang: string) {
  const fd = new FormData();
  fd.append("audio", wav(pcm), "speech.wav"); fd.append("lang", lang);
  const r = await fetch("/api/ai/stt", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "fail");
  return String(j.text ?? "").trim();
}

type St = "idle" | "rec" | "busy";

/** Кнопка «Надиктовать»: текст приходит кусками через onText (по порядку). */
export function Dictate({ onText, lang = "ru-RU", label, className = "", round }: { onText: (text: string) => void; lang?: "ru-RU" | "en-US"; label?: string; className?: string; round?: boolean }) {
  const { t } = useT();
  const [st, setSt] = useState<St>("idle");
  const [sec, setSec] = useState(0);
  const [lvl, setLvl] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const r = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; buf: number[]; t0: number; timer: number; queue: Promise<void>; pending: number } | null>(null);
  const cb = useRef(onText); cb.current = onText;

  const send = (samples: number[]) => {
    const x = r.current; if (!x || samples.length < RATE * 0.4) return;
    const pcm = Int16Array.from(samples, (s) => Math.max(-1, Math.min(1, s)) * 0x7fff);
    x.pending++;
    // по порядку: следующий кусок распознаётся после предыдущего, текст добавляется в том же порядке
    x.queue = x.queue.then(async () => {
      try { const txt = await recognize(pcm, lang); if (txt) cb.current(txt); }
      catch (e) { setErr(t(`ai.err.${(e as Error).message}` as "ai.err.fail") || t("ai.err.fail")); }
      finally { x.pending--; }
    });
  };

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const ratio = ctx.sampleRate / RATE;
      const x = { ctx, stream, node, buf: [] as number[], t0: Date.now(), timer: 0, queue: Promise.resolve(), pending: 0 };
      r.current = x;
      node.onaudioprocess = (e) => {
        const inp = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inp.length; i++) sum += inp[i] * inp[i];
        const rms = Math.sqrt(sum / inp.length);
        setLvl(Math.min(1, rms * 8));
        // понижение частоты до 16 кГц (усреднение)
        for (let pos = 0; pos < inp.length; pos += ratio) {
          const a = Math.floor(pos), b = Math.min(inp.length, Math.floor(pos + ratio));
          let s = 0; for (let i = a; i < b; i++) s += inp[i];
          x.buf.push(b > a ? s / (b - a) : inp[a]);
        }
        const secs = x.buf.length / RATE;
        // режем на паузе после 20 с или жёстко на 28 с — слова не рвутся
        if ((secs >= MIN_S && rms < SILENT) || secs >= MAX_S) { const chunk = x.buf; x.buf = []; send(chunk); }
      };
      src.connect(node); node.connect(ctx.destination);
      x.timer = window.setInterval(() => setSec(Math.floor((Date.now() - x.t0) / 1000)), 250);
      setSec(0); setSt("rec");
    } catch { setErr(t("dict.noMic")); setSt("idle"); }
  };

  const stop = async () => {
    const x = r.current; if (!x) return;
    setSt("busy");
    clearInterval(x.timer);
    x.node.disconnect(); x.stream.getTracks().forEach((tr) => tr.stop()); await x.ctx.close().catch(() => {});
    const rest = x.buf; x.buf = []; send(rest);
    await x.queue;
    r.current = null; setLvl(0); setSt("idle");
  };

  useEffect(() => () => { const x = r.current; if (x) { clearInterval(x.timer); x.stream.getTracks().forEach((tr) => tr.stop()); x.ctx.close().catch(() => {}); } }, []);

  const mm = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  if (st === "idle" && round) return (
    <span className={`dict round ${className}`}>
      <button type="button" className="dict-mic" onClick={start} aria-label={label ?? t("dict.go")} title={label ?? t("dict.go")}><Icon name="mic" /></button>
      {err && <span className="small text-bad dict-err">{err}</span>}
    </span>
  );
  if (st === "idle") return (
    <span className={`dict ${className}`}>
      <button type="button" className="btn plain sm" onClick={start}><Icon name="mic" size="sm" />{label ?? t("dict.go")}</button>
      {err && <span className="small text-bad">{err}</span>}
    </span>
  );
  return (
    <div className={`dict-bar ${st} ${className}`} role="status" aria-live="polite">
      {st === "rec" ? <span className="dict-dot" /> : <span className="dict-spin" />}
      <span className="dict-lbl">{st === "rec" ? t("dict.rec", { t: mm }) : t("dict.busy")}</span>
      {st === "rec" && <span className="dict-meter" aria-hidden><span style={{ transform: `scaleX(${Math.max(0.04, lvl)})` }} /></span>}
      {st === "rec" && <button type="button" className="btn danger sm" onClick={stop}><span className="dict-sq" />{t("dict.stop")}</button>}
    </div>
  );
}
