"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { answerCore, draftText, finishPlacement, finishTexts, notePlay, saveWriting, startPlacement } from "@/lib/placement/actions";
import type { PView } from "@/lib/placement/run";
import { Icon } from "../Icon";
import type { IconName } from "../icon-paths";

const PARTS = ["core", "reading", "listening", "writing", "speaking"] as const;
type Part = (typeof PARTS)[number];
const PART_ICON: Record<Part, IconName> = { core: "book", reading: "note", listening: "sound", writing: "pencil", speaking: "mic" };
type V = PView;
type Core = Extract<V, { section: "core" }>;
type TQ = { id: string; q: string; options: string[]; v: number | null };
type TItem = { id: string; title: string; questions: TQ[]; passage?: string; situation?: string; audio?: string; plays?: number; used?: number };
type TextV = { section: "reading" | "listening"; instr?: string; extra?: boolean; items: TItem[] };
type WriteV = Extract<V, { section: "writing" }>;
type SpeakV = Extract<V, { section: "speaking" }>;

const wc = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Прохождение вводного теста. Каждый ответ сразу сохраняется — можно уйти и продолжить позже. */
export function PlacementRunner({ id, initial, sample, done, home }: { id: string; initial: V; sample: string; done: React.ReactNode; home: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const [v, setV] = useState<V>(initial);
  const [between, setBetween] = useState<{ from: Part; to: Part } | null>(null);
  const [paused, setPaused] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shownAt = useRef(Date.now());
  const step = (fn: () => Promise<{ ok: boolean; view?: V; error?: string }>) =>
    start(async () => {
      setErr(null);
      const r = await fn().catch(() => ({ ok: false, error: "net" }) as const);
      if (!r.ok) { setErr(r.error === "done" ? t("pl.err.done") : r.error === "plays" ? t("pl.err.plays") : r.error === "empty" ? t("pl.err.empty") : t("pl.err.net")); if (r.error === "done") location.reload(); return; }
      if (!r.view) return;
      const from = v.section, to = r.view.section;
      setV(r.view); shownAt.current = Date.now();
      if (from !== to) {
        window.scrollTo({ top: 0 });
        if (to === "done") router.refresh();
        else if (from !== "intro" && (PARTS as readonly string[]).includes(from) && (PARTS as readonly string[]).includes(to)) setBetween({ from: from as Part, to: to as Part });
      }
    });
  const ms = () => Date.now() - shownAt.current;

  if (v.section === "done") return <>{done}</>;
  if (paused) return <Paused home={home} onBack={() => setPaused(false)} />;
  const pi = PARTS.indexOf(v.section as Part);
  return (
    <div className="flex flex-col gap-4">
      {v.section !== "intro" && (
        <div className="flex flex-col gap-2">
          <div className="plprog" aria-label={t("pl.progress")}>
            {PARTS.map((p, i) => <span key={p} className={i === pi ? "on" : i < pi ? "done" : ""}>{i < pi && <Icon name="check" size="sm" />}{t(`pl.part.${p}` as DictKey)}</span>)}
          </div>
          {v.section === "core" && !between && (
            <div className="plcorebar" role="progressbar" aria-label={t("pl.coreProgress")} aria-valuenow={Math.round(((v as Core).progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.max(4, ((v as Core).progress ?? 0) * 100)}%` }} />
            </div>
          )}
        </div>
      )}
      {between ? <Between from={between.from} to={between.to} onGo={() => { setBetween(null); shownAt.current = Date.now(); }} /> : <>
        {v.section === "intro" && <Intro sample={sample} pending={pending} onStart={() => step(() => startPlacement(id))} />}
        {v.section === "core" && <CoreStep key={(v as Core).item?.id} v={v as Core} pending={pending} onAnswer={(val, dk) => step(() => answerCore(id, (v as Core).item!.id, val, ms(), dk))} />}
        {(v.section === "reading" || v.section === "listening") && (
          <TextStep key={(v as unknown as TextV).items.map((x) => x.id).join()} v={v as unknown as TextV} pending={pending} attempt={id} onFinish={() => step(() => finishTexts(id))} />
        )}
        {v.section === "writing" && <WriteStep v={v as WriteV} pending={pending} onSave={(text, final) => final ? step(() => saveWriting(id, text, true)) : saveWriting(id, text, false)} />}
        {v.section === "speaking" && <SpeakStep v={v as SpeakV} attempt={id} pending={pending} onFinish={(noMic) => step(() => finishPlacement(id, noMic))} />}
      </>}
      {err && <div className="alert">{err}</div>}
      {v.section !== "intro" && !between && (
        <div className="plpause">
          <span className="small muted">{t("pl.saved")}</span>
          <button type="button" className="btn plain sm" onClick={() => setPaused(true)}><Icon name="clock" size="sm" />{t("pl.saveLater")}</button>
        </div>
      )}
    </div>
  );
}

function Paused({ home, onBack }: { home: string | null; onBack: () => void }) {
  const { t } = useT();
  return (
    <section className="card flex flex-col items-center gap-3 text-center">
      <span className="plck ok big"><Icon name="check" /></span>
      <h2 className="m-0">{t("pl.pausedTitle")}</h2>
      <p className="muted m-0" style={{ maxWidth: 460 }}>{home ? t(home.startsWith("/student") ? "pl.pausedStudent" : "pl.pausedTeacher") : t("pl.pausedGuest")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button className="btn primary" onClick={onBack}>{t("pl.backToTest")}</button>
        {home && <a className="btn secondary" href={home}>{t("pl.exitNow")}</a>}
      </div>
    </section>
  );
}

/** Экран между разделами: раздел завершён, что дальше. */
function Between({ from, to, onGo }: { from: Part; to: Part; onGo: () => void }) {
  const { t } = useT();
  return (
    <section className="card plbetween">
      <span className="plck ok big"><Icon name="check" /></span>
      <h2 className="m-0">{t("pl.partDone", { part: t(`pl.part.${from}` as DictKey) })}</h2>
      <p className="muted m-0">{from === "core" ? t("pl.coreLocked") : t("pl.partLocked")}</p>
      <div className="plnext">
        <span className="plico sm"><Icon name={PART_ICON[to]} /></span>
        <div className="grow text-left"><div className="small muted">{t("pl.nextPart")}</div><b>{t(`pl.part.${to}` as DictKey)}</b><div className="small muted">{t(`pl.partHint.${to}` as DictKey)} · {t(`pl.partTime.${to}` as DictKey)}</div></div>
      </div>
      <button className="btn primary lg" onClick={onGo}>{t("pl.goOn")}</button>
    </section>
  );
}

// ───────── Вводный экран ─────────

function Intro({ sample, pending, onStart }: { sample: string; pending: boolean; onStart: () => void }) {
  const { t } = useT();
  const [snd, setSnd] = useState<"idle" | "play" | "ok">("idle");
  const [mic, setMic] = useState<"idle" | "rec" | "ok" | "err">("idle");
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
    <section className="card plintro">
      <div className="plhero">
        <h2 className="m-0">{t("pl.introTitle")}</h2>
        <p className="muted m-0">{t("pl.introLead")}</p>
        <div className="plfacts">
          <span><Icon name="clock" size="sm" />{t("pl.factTime")}</span>
          <span><Icon name="target" size="sm" />{t("pl.factLevels")}</span>
          <span><Icon name="spark" size="sm" />{t("pl.factAdaptive")}</span>
        </div>
      </div>
      <div className="plpartgrid">
        {PARTS.map((p, i) => (
          <div key={p} className="plpart">
            <span className="plico sm"><Icon name={PART_ICON[p]} /></span>
            <div><b>{i + 1}. {t(`pl.part.${p}` as DictKey)}</b><div className="small muted">{t(`pl.partHint.${p}` as DictKey)}</div><div className="small plpart-t">{t(`pl.partTime.${p}` as DictKey)}</div></div>
          </div>
        ))}
      </div>
      <div className="plrules">
        <div><Icon name="check" size="sm" /><span>{t("pl.rule1")}</span></div>
        <div><Icon name="qmark" size="sm" /><span>{t("pl.rule2")}</span></div>
        <div><Icon name="right" size="sm" /><span>{t("pl.rule3")}</span></div>
      </div>
      <div className="plchecks">
        <div className="plcheck">
          <span className={`plck ${snd === "ok" ? "ok" : ""}`}><Icon name={snd === "ok" ? "check" : "sound"} size="sm" /></span>
          <div className="grow"><b>{t("pl.sound")}</b><div className="small muted">{t("pl.soundHint")}</div></div>
          <button type="button" className="btn secondary sm" onClick={playSample} disabled={snd === "play"}>{snd === "play" ? t("pl.playing") : snd === "ok" ? t("pl.again") : t("pl.check")}</button>
        </div>
        <div className="plcheck">
          <span className={`plck ${mic === "ok" ? "ok" : mic === "err" ? "bad" : ""}`}><Icon name={mic === "ok" ? "check" : "mic"} size="sm" /></span>
          <div className="grow"><b>{t("pl.mic")}</b><div className="small muted">{mic === "err" ? t("pl.micErr") : mic === "rec" ? t("pl.micRec") : t("pl.micHint")}</div></div>
          {back && mic === "ok" && <button type="button" className="btn plain sm" onClick={() => new Audio(back).play()}>{t("pl.listenMine")}</button>}
          <button type="button" className="btn secondary sm" onClick={testMic} disabled={mic === "rec"}>{mic === "rec" ? "…" : t("pl.check")}</button>
        </div>
      </div>
      <button className="btn primary lg self-center" disabled={pending} onClick={onStart}>{t("pl.start")}</button>
    </section>
  );
}

// ───────── Грамматика и лексика ─────────

function CoreStep({ v, pending, onAnswer }: { v: Core; pending: boolean; onAnswer: (val: string | number | null, dk: boolean) => void }) {
  const { t } = useT();
  const it = v.item;
  const [val, setVal] = useState<string | number>("");
  if (!it) return null;
  const input = (
    <input className="input plgap" autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} value={String(val)} onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && String(val).trim()) onAnswer(String(val), false); }} aria-label={t("pl.answer")} />
  );
  const parts = (s: string) => { const [a, b] = s.split("___"); return <p className="plq">{a}{input}{b}</p>; };
  const empty = val === "" || (typeof val === "string" && !val.trim());
  return (
    <section className="card flex flex-col gap-4" data-item={it.id}>
      <p className="plinstr">{it.instr}</p>
      {it.type === "mcq" && (
        <>
          <p className="plq">{it.q.split("___").map((x, i, a) => <span key={i}>{x}{i < a.length - 1 && <span className="plblank">{typeof val === "number" ? it.options![val] : " "}</span>}</span>)}</p>
          <div className="ploptions">{it.options!.map((o, k) => <button key={k} type="button" className={`topt ${val === k ? "on" : ""}`} aria-pressed={val === k} onClick={() => setVal(k)}>{o}</button>)}</div>
        </>
      )}
      {it.type === "wordform" && <><div className="plword"><span className="plbase">{it.base}</span><Icon name="right" size="sm" /><span className="muted small">?</span></div>{parts(it.q)}</>}
      {it.type === "gap" && parts(it.q)}
      {it.type === "transform" && (
        <>
          <p className="plq m-0">{it.q}</p>
          <div className="plword"><span className="small muted">{t("pl.useWord")}</span><span className="plbase">{it.key}</span></div>
          {parts(it.frame ?? "___")}
        </>
      )}
      <div className="plactions">
        <button type="button" className="btn plain" disabled={pending} onClick={() => onAnswer(null, true)}>{t("pl.dontKnow")}</button>
        <button className="btn primary" disabled={pending || empty} onClick={() => onAnswer(val, false)}>{t("pl.next")}</button>
      </div>
    </section>
  );
}

// ───────── Чтение и аудирование ─────────

function TextStep({ v, pending, onFinish, attempt }: { v: TextV; pending: boolean; onFinish: () => void; attempt: string }) {
  const { t } = useT();
  const [tab, setTab] = useState(0);
  const [ans, setAns] = useState<Record<string, number>>(() => Object.fromEntries(v.items.flatMap((x) => x.questions.filter((q) => q.v !== null).map((q) => [q.id, q.v!]))));
  const [playing, setPlaying] = useState(false);
  const listen = v.section === "listening";
  const pick = (qid: string, k: number) => { setAns((a) => ({ ...a, [qid]: k })); void draftText(attempt, qid, k); };
  const total = v.items.reduce((a, x) => a + x.questions.length, 0);
  const left = total - Object.keys(ans).filter((k) => v.items.some((x) => x.questions.some((q) => q.id === k))).length;
  const it = v.items[Math.min(tab, v.items.length - 1)];
  const finish = () => { if (!confirm(left ? t("pl.finishLeft", { n: left }) : t("pl.finishSure"))) return; onFinish(); };
  if (!it) return null;
  return (
    <section className="card flex flex-col gap-4">
      {v.extra && <div className="alert ok" style={{ background: "var(--accent-bg)", color: "var(--accent-text)" }}>{t("pl.extraText")}</div>}
      <p className="plinstr">{v.instr}</p>
      {v.items.length > 1 && (
        <nav className="tabsbar">{v.items.map((x, i) => {
          const n = x.questions.filter((q) => ans[q.id] !== undefined).length;
          return <button key={x.id} type="button" aria-current={i === tab ? "page" : undefined} disabled={playing} onClick={() => setTab(i)}>{t(listen ? "pl.recTab" : "pl.textTab", { n: i + 1 })} <span className="small muted">{n}/{x.questions.length}</span></button>;
        })}</nav>
      )}
      <h3 className="m-0">{it.title}</h3>
      {listen ? <Player key={it.id} it={it} attempt={attempt} onPlaying={setPlaying} /> : <div className="tpassage plpassage">{it.passage}</div>}
      {it.questions.map((q, n) => (
        <fieldset key={q.id} className="tq">
          <legend><span className="tk-num">{n + 1}</span>{q.q}</legend>
          <div className="flex flex-col gap-2">
            {q.options.map((o, k) => <label key={k} className={`topt ${ans[q.id] === k ? "on" : ""}`}><input type="radio" name={q.id} checked={ans[q.id] === k} onChange={() => pick(q.id, k)} />{o}</label>)}
            <label className={`topt dk ${ans[q.id] === -1 ? "on" : ""}`}><input type="radio" name={q.id} checked={ans[q.id] === -1} onChange={() => pick(q.id, -1)} />{t("pl.dontKnow")}</label>
          </div>
        </fieldset>
      ))}
      <div className="plactions">
        {tab < v.items.length - 1 && <button type="button" className="btn secondary" disabled={playing} onClick={() => { setTab(tab + 1); window.scrollTo({ top: 0 }); }}>{t(listen ? "pl.nextRec" : "pl.nextText")}</button>}
        <button className="btn primary" disabled={pending || playing} onClick={finish}>{t("pl.finishPart")}</button>
      </div>
      <p className="small muted m-0 text-right">{left ? t("pl.leftQ", { n: left }) : t("pl.allAnswered")}</p>
    </section>
  );
}

function Player({ it, attempt, onPlaying }: { it: TItem; attempt: string; onPlaying: (p: boolean) => void }) {
  const { t } = useT();
  const plays = it.plays ?? 2;
  const [used, setUsed] = useState(it.used ?? 0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const play = async () => {
    if (playing || used >= plays) return;
    const r = await notePlay(attempt, it.id).catch(() => ({ ok: false }));
    if (!r.ok) { setUsed(plays); return; }
    setUsed(used + 1);
    const a = audio.current!;
    a.currentTime = 0; setPlaying(true); onPlaying(true);
    a.play().catch(() => { setPlaying(false); onPlaying(false); });
  };
  return (
    <div className="plaudio">
      {it.situation && <p className="m-0">{it.situation}</p>}
      <audio ref={audio} src={it.audio} preload="auto" onTimeUpdate={(e) => setPos(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)} onEnded={() => { setPlaying(false); onPlaying(false); setPos(0); }} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="plplay" disabled={playing || used >= plays} onClick={play} aria-label={used ? t("pl.listenAgain") : t("pl.listen")}><Icon name="sound" /></button>
        <div className="grow min-w-[180px]">
          <b>{playing ? t("pl.playing") : used >= plays ? t("pl.noPlays") : used ? t("pl.listenAgain") : t("pl.listen")}</b>
          <div className="plbar mt-2"><div style={{ width: `${pos * 100}%` }} /></div>
        </div>
        <div className="plplays">{Array.from({ length: plays }, (_, i) => <span key={i} className={i < used ? "used" : ""}>{t("pl.playN", { n: i + 1 })}</span>)}</div>
      </div>
    </div>
  );
}

// ───────── Письмо ─────────

function WriteStep({ v, pending, onSave }: { v: WriteV; pending: boolean; onSave: (text: string, final: boolean) => unknown }) {
  const { t } = useT();
  const [text, setText] = useState(v.text);
  const [ru, setRu] = useState(false);
  const last = useRef(v.text);
  const save = useRef(onSave); save.current = onSave;
  useEffect(() => {
    const h = setTimeout(() => { if (text !== last.current) { last.current = text; void save.current(text, false); } }, 3000);
    return () => clearTimeout(h);
  }, [text]);
  const it = v.item;
  if (!it) return null;
  const n = wc(text);
  const fill = Math.min(1, n / it.max);
  const submit = () => { if (n < it.min ? !confirm(t("pl.fewWords", { n, min: it.min })) : !confirm(t("pl.finishWriting"))) return; onSave(text, true); };
  return (
    <section className="card flex flex-col gap-4">
      <p className="plinstr">{v.instr}</p>
      <div className="plletter">
        <div className="plletter-h"><Icon name="msg" size="sm" /><b>{it.kind}</b><span className="grow" /><span className="small muted">{t("pl.wordsGoal", { a: it.min, b: it.max })}</span></div>
        <p className="plq m-0">{it.prompt_en}</p>
        {it.points.length > 0 && (
          <div className="plpoints"><div className="small muted mb-1">{t("pl.includePoints")}</div>
            {it.points.map((p) => <div key={p} className="plpoint"><span className="pldotc" />{p}</div>)}
          </div>
        )}
        <button type="button" className="btn plain sm self-start" onClick={() => setRu(!ru)}>{ru ? t("pl.hideRu") : t("pl.showRu")}</button>
        {ru && <p className="small muted m-0">{it.prompt_ru}</p>}
      </div>
      <div className="plpaper">
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoCorrect="off" placeholder={t("pl.writeHere")} aria-label={t("pl.part.writing")} />
        <div className="plpaper-f">
          <div className="plwbar"><div className={n > it.max ? "over" : n >= it.min ? "ok" : ""} style={{ width: `${fill * 100}%` }} /><i style={{ left: `${(it.min / it.max) * 100}%` }} /></div>
          <span className={`small ${n > it.max ? "text-bad" : n >= it.min ? "text-ok" : "muted"}`}>{t("pl.wordsN", { n })}</span>
        </div>
      </div>
      <div className="plactions"><button className="btn primary" disabled={pending || n < 3} onClick={submit}>{t("pl.finishPart")}</button></div>
    </section>
  );
}

// ───────── Говорение ─────────

function Ring({ left, total, rec }: { left: number; total: number; rec?: boolean }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <span className={`plring ${rec ? "rec" : ""}`}>
      <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r={r} className="bg" /><circle cx="32" cy="32" r={r} className="fg" strokeDasharray={c} strokeDashoffset={c * (1 - left / Math.max(1, total))} /></svg>
      <b>{left}</b>
    </span>
  );
}

function SpeakStep({ v, attempt, pending, onFinish }: { v: SpeakV; attempt: string; pending: boolean; onFinish: (noMic: boolean) => void }) {
  const { t } = useT();
  const it = v.item;
  const [done, setDone] = useState<string[]>(v.rec);
  const [ver, setVer] = useState<Record<string, number>>({});
  const first = it ? it.questions.findIndex((_, i) => !v.rec.includes(String(i + 1))) : -1;
  const [cur, setCur] = useState<number | null>(first >= 0 ? first : null);
  const [phase, setPhase] = useState<"ready" | "prep" | "rec" | "up">("ready");
  const [left, setLeft] = useState(0);
  const [micErr, setMicErr] = useState(false);
  const rec = useRef<{ r: MediaRecorder; s: MediaStream; chunks: Blob[] } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.s.getTracks().forEach((x) => x.stop()); }, []);
  if (!it) return null;
  const q = cur !== null ? it.questions[cur] : null;
  const busy = phase !== "ready";

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
    const c = rec.current; if (!c || cur === null) return;
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setPhase("up");
    const n = String(cur + 1);
    c.r.onstop = async () => {
      c.s.getTracks().forEach((x) => x.stop());
      const fd = new FormData(); fd.append("file", new Blob(c.chunks, { type: c.r.mimeType || "audio/webm" }), "answer.webm");
      for (let tries = 0; tries < 3; tries++) {
        const res = await fetch(`/api/placement/${attempt}/rec/${n}`, { method: "POST", body: fd }).catch(() => null);
        if (res?.ok) {
          const nd = done.includes(n) ? done : [...done, n];
          setDone(nd); setVer((x) => ({ ...x, [n]: (x[n] ?? 0) + 1 })); rec.current = null; setPhase("ready");
          const nx = it!.questions.findIndex((_, i) => !nd.includes(String(i + 1)));
          setCur(nx >= 0 ? nx : null);
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      setMicErr(true); setPhase("ready");
    };
    c.r.stop();
  }
  const all = done.length >= it.questions.length;
  return (
    <section className="card flex flex-col gap-4">
      <p className="plinstr">{v.instr}</p>
      <div className="plguide"><Icon name="info" size="sm" /><span><b>{it.intro}</b> {t(`pl.speakGuide.${it.level}` as DictKey)}</span></div>
      <div className="flex flex-col gap-3">
        {it.questions.map((x, i) => {
          const n = String(i + 1), has = done.includes(n), active = cur === i;
          return (
            <div key={i} className={`plsq ${active ? "on" : ""} ${has ? "ok" : ""}`}>
              <div className="flex items-center gap-2">
                <span className={`plsq-n ${has ? "ok" : ""}`}>{has ? <Icon name="check" size="sm" /> : i + 1}</span>
                <span className="grow small muted">{t("pl.qOf", { a: i + 1, b: it.questions.length })} · {t("pl.speakLimit", { s: x.speak })}</span>
                {has && !active && <button type="button" className="btn plain sm" disabled={busy} onClick={() => { setCur(i); setPhase("ready"); }}>{t("pl.rerecord")}</button>}
              </div>
              {(active && phase !== "ready") || has ? <p className="plq m-0">{x.q}</p> : null}
              {has && !(active && busy) && <audio controls preload="none" src={`/api/placement/${attempt}/rec/${n}?v=${ver[n] ?? 0}`} className="w-full" />}
              {active && (
                <div className="flex flex-wrap items-center gap-3">
                  {phase === "ready" && <><span className="small muted grow">{t("pl.speakReady", { p: x.prep, s: x.speak })}</span><button className="btn primary" onClick={begin}><Icon name="sound" size="sm" />{has ? t("pl.recordAgain") : t("pl.showQ")}</button></>}
                  {phase === "prep" && <><Ring left={left} total={x.prep} /><span className="small muted grow">{t("pl.prep")}</span><button className="btn primary" onClick={record}><Icon name="mic" size="sm" />{t("pl.speakNow")}</button></>}
                  {phase === "rec" && <><Ring left={left} total={x.speak} rec /><span className="small grow"><span className="recdot" />{t("pl.recording")}</span><button className="btn secondary" onClick={stop}>{t("pl.stop")}</button></>}
                  {phase === "up" && <span className="small muted">{t("pl.uploading")}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {micErr && (
        <div className="alert flex flex-col items-start gap-2">
          <span>{t("pl.micFail")}</span>
          <button className="btn plain sm" disabled={pending} onClick={() => { if (confirm(t("pl.noMicConfirm"))) onFinish(true); }}>{t("pl.noMic")}</button>
        </div>
      )}
      {all && !busy && (
        <div className="plactions"><span className="small muted grow">{t("pl.speakDone")}</span><button className="btn primary" disabled={pending} onClick={() => { if (confirm(t("pl.finishTest"))) onFinish(false); }}>{t("pl.finish")}</button></div>
      )}
    </section>
  );
}
