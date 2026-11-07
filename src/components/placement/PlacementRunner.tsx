"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { answerCore, answerText, finishPlacement, notePlay, saveWriting, startPlacement } from "@/lib/placement/actions";
import type { PView } from "@/lib/placement/run";
import { Icon } from "../Icon";

const PARTS = ["core", "reading", "listening", "writing", "speaking"] as const;
type V = PView;
type Core = Extract<V, { section: "core" }>;
type TextV = Extract<V, { section: "reading" | "listening" }> & { item: { id: string; title: string; questions: { id: string; q: string; options: string[] }[]; passage?: string; situation?: string; audio?: string; plays?: number; used?: number } | null };
type WriteV = Extract<V, { section: "writing" }>;
type SpeakV = Extract<V, { section: "speaking" }>;

const wc = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Прохождение вводного теста. Каждый ответ сразу сохраняется — можно закрыть вкладку и продолжить позже. */
export function PlacementRunner({ id, initial, sample, done }: { id: string; initial: V; sample: string; done: React.ReactNode }) {
  const { t } = useT();
  const router = useRouter();
  const [v, setV] = useState<V>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shownAt = useRef(Date.now());
  const step = (fn: () => Promise<{ ok: boolean; view?: V; error?: string }>) =>
    start(async () => {
      setErr(null);
      const r = await fn().catch(() => ({ ok: false, error: "net" }) as const);
      if (!r.ok) { setErr(r.error === "done" ? t("pl.err.done") : r.error === "plays" ? t("pl.err.plays") : r.error === "empty" ? t("pl.err.empty") : t("pl.err.net")); if (r.error === "done") location.reload(); return; }
      if (r.view) { setV(r.view); shownAt.current = Date.now(); if (r.view.section !== v.section) window.scrollTo({ top: 0 }); if (r.view.section === "done") router.refresh(); }
    });
  const ms = () => Date.now() - shownAt.current;

  if (v.section === "done") return <>{done}</>;
  const pi = PARTS.indexOf(v.section as (typeof PARTS)[number]);
  return (
    <div className="flex flex-col gap-4">
      {v.section !== "intro" && (
        <div className="plprog" aria-label={t("pl.progress")}>
          {PARTS.map((p, i) => <span key={p} className={i === pi ? "on" : i < pi ? "done" : ""}>{i < pi && <Icon name="check" size="sm" />}{t(`pl.part.${p}`)}</span>)}
        </div>
      )}
      {v.section === "intro" && <Intro sample={sample} pending={pending} onStart={(b) => step(() => startPlacement(id, b))} />}
      {v.section === "core" && <CoreStep key={(v as Core).item?.id} v={v as Core} pending={pending} onAnswer={(val) => step(() => answerCore(id, (v as Core).item!.id, val, ms()))} />}
      {(v.section === "reading" || v.section === "listening") && (v as TextV).item && (
        <TextStep key={(v as TextV).item!.id} v={v as TextV} pending={pending} attempt={id} onPlay={() => notePlay(id, (v as TextV).item!.id)} onAnswer={(a) => step(() => answerText(id, (v as TextV).item!.id, a, ms()))} />
      )}
      {v.section === "writing" && <WriteStep v={v as WriteV} pending={pending} onSave={(text, final) => final ? step(() => saveWriting(id, text, true)) : saveWriting(id, text, false)} />}
      {v.section === "speaking" && <SpeakStep v={v as SpeakV} attempt={id} pending={pending} onFinish={(noMic) => step(() => finishPlacement(id, noMic))} />}
      {err && <div className="alert">{err}</div>}
      {v.section !== "intro" && <p className="hint m-0 text-center">{t("pl.saved")}</p>}
    </div>
  );
}

// ───────── Вводный экран: звук и микрофон ─────────

function Intro({ sample, pending, onStart }: { sample: string; pending: boolean; onStart: (beginner: boolean) => void }) {
  const { t } = useT();
  const [snd, setSnd] = useState<"idle" | "play" | "ok">("idle");
  const [mic, setMic] = useState<"idle" | "rec" | "ok" | "err">("idle");
  const [beginner, setBeginner] = useState(false);
  const [back, setBack] = useState<string | null>(null);
  const playSample = () => { const a = new Audio(sample); setSnd("play"); a.onended = () => setSnd("ok"); a.play().catch(() => setSnd("idle")); };
  const testMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream), chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => { stream.getTracks().forEach((x) => x.stop()); const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })); setBack(url); setMic("ok"); new Audio(url).play().catch(() => null); };
      setMic("rec"); rec.start(); setTimeout(() => rec.state !== "inactive" && rec.stop(), 3000);
    } catch { setMic("err"); }
  };
  return (
    <section className="card flex flex-col gap-4">
      <div>
        <h2 className="mt-0 mb-2">{t("pl.introTitle")}</h2>
        <p className="muted m-0">{t("pl.introLead")}</p>
      </div>
      <ol className="plparts">{PARTS.map((p) => <li key={p}><b>{t(`pl.part.${p}`)}</b><span className="small muted">{t(`pl.partHint.${p}`)}</span></li>)}</ol>
      <div className="plchecks">
        <div className="plcheck">
          <span className={`plck ${snd === "ok" ? "ok" : ""}`}><Icon name={snd === "ok" ? "check" : "sound"} size="sm" /></span>
          <div className="grow"><b>{t("pl.sound")}</b><div className="small muted">{t("pl.soundHint")}</div></div>
          <button type="button" className="btn secondary sm" onClick={playSample} disabled={snd === "play"}>{snd === "play" ? t("pl.playing") : t("pl.check")}</button>
        </div>
        <div className="plcheck">
          <span className={`plck ${mic === "ok" ? "ok" : mic === "err" ? "bad" : ""}`}><Icon name={mic === "ok" ? "check" : "mic"} size="sm" /></span>
          <div className="grow"><b>{t("pl.mic")}</b><div className="small muted">{mic === "err" ? t("pl.micErr") : mic === "rec" ? t("pl.micRec") : t("pl.micHint")}</div></div>
          {back && mic === "ok" && <button type="button" className="btn plain sm" onClick={() => new Audio(back).play()}>{t("pl.again")}</button>}
          <button type="button" className="btn secondary sm" onClick={testMic} disabled={mic === "rec"}>{mic === "rec" ? "…" : t("pl.check")}</button>
        </div>
      </div>
      <label className="flex items-center gap-2 small"><input type="checkbox" checked={beginner} onChange={(e) => setBeginner(e.target.checked)} />{t("pl.beginner")}</label>
      <p className="hint m-0">{t("pl.pauseHint")}</p>
      <div className="flex justify-end"><button className="btn primary" disabled={pending} onClick={() => onStart(beginner)}>{t("pl.start")}</button></div>
    </section>
  );
}

// ───────── Грамматика и лексика ─────────

function CoreStep({ v, pending, onAnswer }: { v: Core; pending: boolean; onAnswer: (val: string | number) => void }) {
  const { t } = useT();
  const it = v.item;
  const [val, setVal] = useState<string | number>("");
  if (!it) return null;
  const input = (
    <input className="input plgap" autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} value={String(val)} onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && String(val).trim()) onAnswer(String(val)); }} aria-label={t("pl.answer")} />
  );
  const parts = (s: string) => { const [a, b] = s.split("___"); return <p className="plq">{a}{input}{b}</p>; };
  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center gap-2"><span className="tk-num">{v.n}</span><span className="small muted">{it.instr}</span></div>
      {it.type === "mcq" && (
        <>
          <p className="plq">{it.q.split("___").map((x, i, a) => <span key={i}>{x}{i < a.length - 1 && <span className="plblank">{typeof val === "number" ? it.options![val] : "____"}</span>}</span>)}</p>
          <div className="ploptions">{it.options!.map((o, k) => <button key={k} type="button" className={`topt ${val === k ? "on" : ""}`} aria-pressed={val === k} onClick={() => setVal(k)}>{o}</button>)}</div>
        </>
      )}
      {(it.type === "gap" || it.type === "wordform") && (
        <>{it.type === "wordform" && <div className="plbase">{it.base}</div>}{parts(it.q)}</>
      )}
      {it.type === "transform" && (
        <>
          <p className="plq m-0">{it.q}</p>
          <div className="plbase">{it.key}</div>
          {parts(it.frame ?? "___")}
        </>
      )}
      <div className="flex justify-end"><button className="btn primary" disabled={pending || val === "" || (typeof val === "string" && !val.trim())} onClick={() => onAnswer(val)}>{t("pl.next")}</button></div>
    </section>
  );
}

// ───────── Чтение и аудирование ─────────

function TextStep({ v, pending, onAnswer, onPlay }: { v: TextV; pending: boolean; attempt: string; onAnswer: (a: Record<string, number>) => void; onPlay: () => Promise<{ ok: boolean; error?: string }> }) {
  const { t } = useT();
  const it = v.item!;
  const [ans, setAns] = useState<Record<string, number>>({});
  const [used, setUsed] = useState(it.used ?? 0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const plays = it.plays ?? 2;
  const play = async () => {
    if (playing || used >= plays) return;
    const r = await onPlay();
    if (!r.ok) { setUsed(plays); return; }
    setUsed(used + 1);
    const a = audio.current!;
    a.currentTime = 0; setPlaying(true);
    a.play().catch(() => setPlaying(false));
  };
  const all = it.questions.every((q) => ans[q.id] !== undefined);
  return (
    <section className="card flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2"><span className="pill grey">{t(v.section === "reading" ? "pl.textN" : "pl.recN", { a: v.idx, b: v.total })}</span><span className="small muted">{v.instr}</span></div>
      <h3 className="m-0">{it.title}</h3>
      {v.section === "reading" ? <div className="tpassage plpassage">{it.passage}</div> : (
        <div className="plaudio">
          {it.situation && <p className="m-0">{it.situation}</p>}
          <audio ref={audio} src={it.audio} preload="auto" onTimeUpdate={(e) => setPos(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)} onEnded={() => { setPlaying(false); setPos(1); }} />
          <div className="flex items-center gap-3">
            <button type="button" className="btn primary" disabled={playing || used >= plays} onClick={play}><Icon name="sound" size="sm" />{playing ? t("pl.playing") : used ? t("pl.listenAgain") : t("pl.listen")}</button>
            <span className="small muted">{t("pl.playsLeft", { n: Math.max(0, plays - used) })}</span>
          </div>
          <div className="plbar"><div style={{ width: `${pos * 100}%` }} /></div>
        </div>
      )}
      {it.questions.map((q, n) => (
        <fieldset key={q.id} className="tq">
          <legend><span className="tk-num">{n + 1}</span>{q.q}</legend>
          <div className="flex flex-col gap-2">
            {q.options.map((o, k) => <label key={k} className={`topt ${ans[q.id] === k ? "on" : ""}`}><input type="radio" name={q.id} checked={ans[q.id] === k} onChange={() => setAns({ ...ans, [q.id]: k })} />{o}</label>)}
          </div>
        </fieldset>
      ))}
      <div className="flex justify-end"><button className="btn primary" disabled={pending || !all || playing} onClick={() => onAnswer(ans)}>{t("pl.next")}</button></div>
    </section>
  );
}

// ───────── Письмо ─────────

function WriteStep({ v, pending, onSave }: { v: WriteV; pending: boolean; onSave: (text: string, final: boolean) => unknown }) {
  const { t } = useT();
  const [text, setText] = useState(v.text);
  const last = useRef(v.text);
  useEffect(() => {
    const h = setTimeout(() => { if (text !== last.current) { last.current = text; void onSave(text, false); } }, 4000);
    return () => clearTimeout(h);
  }, [text, onSave]);
  const it = v.item;
  if (!it) return null;
  const n = wc(text);
  const submit = () => { if (n < it.min && !confirm(t("pl.fewWords", { n, min: it.min }))) return; onSave(text, true); };
  return (
    <section className="card flex flex-col gap-3">
      <span className="small muted">{v.instr}</span>
      <p className="plq m-0">{it.prompt_en}</p>
      <p className="small muted m-0">{it.prompt_ru}</p>
      <textarea className="textarea" style={{ minHeight: 260 }} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoCorrect="off" aria-label={t("pl.part.writing")} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`small ${n > it.max ? "text-bad" : n >= it.min ? "text-ok" : "muted"}`}>{t("pl.words", { n, a: it.min, b: it.max })} · {t("pl.timeHint", { n: it.time })}</span>
        <button className="btn primary" disabled={pending || n < 3} onClick={submit}>{t("pl.submitWriting")}</button>
      </div>
    </section>
  );
}

// ───────── Говорение ─────────

function SpeakStep({ v, attempt, pending, onFinish }: { v: SpeakV; attempt: string; pending: boolean; onFinish: (noMic: boolean) => void }) {
  const { t } = useT();
  const it = v.item;
  const [done, setDone] = useState<string[]>(v.rec);
  const [phase, setPhase] = useState<"ready" | "prep" | "rec" | "up">("ready");
  const [left, setLeft] = useState(0);
  const [micErr, setMicErr] = useState(false);
  const rec = useRef<{ r: MediaRecorder; s: MediaStream; chunks: Blob[] } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const qi = it ? it.questions.findIndex((_, i) => !done.includes(String(i + 1))) : -1;
  const q = it && qi >= 0 ? it.questions[qi] : null;
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.s.getTracks().forEach((x) => x.stop()); }, []);
  if (!it) return null;

  const countdown = (sec: number, then: () => void) => {
    if (timer.current) clearInterval(timer.current);
    setLeft(sec);
    timer.current = setInterval(() => setLeft((x) => { if (x <= 1) { clearInterval(timer.current!); timer.current = null; then(); return 0; } return x - 1; }), 1000);
  };
  const begin = () => {
    if (!q) return;
    if (q.audio) new Audio(q.audio).play().catch(() => null);
    setPhase("prep");
    countdown(q.prep, record);
  };
  async function record() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(s), chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      rec.current = { r, s, chunks };
      r.start(); setPhase("rec");
      countdown(q!.speak, stop);
    } catch { setMicErr(true); setPhase("ready"); }
  }
  function stop() {
    const cur = rec.current; if (!cur) return;
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setPhase("up");
    cur.r.onstop = async () => {
      cur.s.getTracks().forEach((x) => x.stop());
      const blob = new Blob(cur.chunks, { type: cur.r.mimeType || "audio/webm" });
      const fd = new FormData(); fd.append("file", blob, "answer.webm");
      const n = String(qi + 1);
      for (let tries = 0; tries < 3; tries++) {
        const res = await fetch(`/api/placement/${attempt}/rec/${n}`, { method: "POST", body: fd }).catch(() => null);
        if (res?.ok) { setDone((d) => [...d, n]); setPhase("ready"); rec.current = null; return; }
        await new Promise((r) => setTimeout(r, 1500));
      }
      setMicErr(true); setPhase("ready");
    };
    cur.r.stop();
  }
  return (
    <section className="card flex flex-col gap-4">
      <span className="small muted">{v.instr}</span>
      <p className="m-0">{it.intro}</p>
      <div className="flex gap-1.5">{it.questions.map((_, i) => <span key={i} className={`pldot ${done.includes(String(i + 1)) ? "ok" : i === qi ? "on" : ""}`} />)}</div>
      {q ? (
        <div className="plspeak">
          <div className="small muted">{t("pl.qOf", { a: qi + 1, b: it.questions.length })}</div>
          {phase === "ready" ? <p className="muted m-0">{t("pl.speakReady", { p: q.prep, s: q.speak })}</p> : <p className="plq m-0">{q.q}</p>}
          {phase === "ready" && <button className="btn primary self-start" onClick={begin}><Icon name="sound" size="sm" />{t("pl.showQ")}</button>}
          {phase === "prep" && <div className="flex flex-wrap items-center gap-3"><span className="pltimer">{left}</span><span className="small muted">{t("pl.prep")}</span><button className="btn primary sm" onClick={record}><Icon name="mic" size="sm" />{t("pl.speakNow")}</button></div>}
          {phase === "rec" && <div className="flex flex-wrap items-center gap-3"><span className="pltimer rec">{left}</span><span className="small"><span className="recdot" />{t("pl.recording")}</span><button className="btn secondary sm" onClick={stop}>{t("pl.stop")}</button></div>}
          {phase === "up" && <p className="small muted m-0">{t("pl.uploading")}</p>}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2"><p className="m-0">{t("pl.speakDone")}</p><button className="btn primary" disabled={pending} onClick={() => onFinish(false)}>{t("pl.finish")}</button></div>
      )}
      {micErr && (
        <div className="alert flex flex-col items-start gap-2">
          <span>{t("pl.micFail")}</span>
          <button className="btn plain sm" disabled={pending} onClick={() => { if (confirm(t("pl.noMicConfirm"))) onFinish(true); }}>{t("pl.noMic")}</button>
        </div>
      )}
    </section>
  );
}
