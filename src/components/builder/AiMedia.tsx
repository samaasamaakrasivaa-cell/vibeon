"use client";
// Конструктор: «Сгенерировать картинки» для «Слово к картинке» и «Озвучить скрипт» для аудио.
import { useState } from "react";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { pictureFor, voiceScript } from "@/lib/ai/media";

/** Картинки ИИ для слов: только для слов без картинки; у каждой — «другой вариант» (рисуется заново, старый остаётся в библиотеке). */
export function usePictureGen({ words, pics, onPic }: { words: string[]; pics: (string | undefined)[]; onPic: (i: number, url: string) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [lib, setLib] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const one = async (i: number, fresh: boolean) => {
    setBusy((b) => new Set(b).add(i));
    const r = await pictureFor(words[i], fresh, pics[i] ? [pics[i]!] : []).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setBusy((b) => { const n = new Set(b); n.delete(i); return n; });
    if (!r.ok) { setErr(r.error); return; }
    onPic(i, r.url);
    setLib((s) => { const n = new Set(s); if (r.fromLib) n.add(i); else n.delete(i); return n; });
  };
  const missing = words.map((_, i) => i).filter((i) => !pics[i]);
  const all = async () => {
    setErr(null);
    // по 3 одновременно — быстрее, но без лишней нагрузки
    const q = [...missing];
    await Promise.all(Array.from({ length: Math.min(3, q.length) }, async () => { while (q.length) await one(q.shift()!, false); }));
  };
  return { busy, lib, err, one, all, missing } as const;
}

export function PictureGenBar({ g }: { g: ReturnType<typeof usePictureGen> }) {
  const { t } = useT();
  return (
    <div className="aimedia-bar">
      <button type="button" className="btn tinted sm" disabled={!g.missing.length || g.busy.size > 0} onClick={g.all}>
        <Icon name="spark" size="sm" />{g.busy.size ? t("pg2.working", { n: g.busy.size }) : g.missing.length ? t("pg2.gen", { n: g.missing.length }) : t("pg2.allHave")}
      </button>
      <span className="hint">{t("pg2.hint")}</span>
      {g.err && <div className="alert">{g.err}</div>}
    </div>
  );
}

/** «Озвучить скрипт»: голос John (SpeechKit); диалог «Имя: реплика» — собеседники различаются тоном, между репликами пауза. */
export function VoiceScript({ script, onSrc }: { script: string; onSrc: (url: string) => void }) {
  const { t } = useT();
  const [speed, setSpeed] = useState(0.95);
  const [pause, setPause] = useState(600);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setMsg(null);
    const r = await voiceScript(script, { speed, pause }).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setPreview(r.url); onSrc(r.url);
    setMsg(t("tts.done", { s: r.seconds, n: r.speakers }));
  };
  return (
    <div className="aimedia-voice">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn tinted sm" disabled={busy || !script.trim()} onClick={go}><Icon name="sound" size="sm" />{busy ? t("tts.busy") : t("tts.go")}</button>
        <label className="small muted" htmlFor="tts-speed">{t("tts.speed")}</label>
        <select id="tts-speed" className="select xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {[0.8, 0.9, 0.95, 1, 1.1].map((v) => <option key={v} value={v}>{v === 1 ? t("tts.normal") : `×${v}`}</option>)}
        </select>
        <label className="small muted" htmlFor="tts-pause">{t("tts.pause")}</label>
        <select id="tts-pause" className="select xs" value={pause} onChange={(e) => setPause(Number(e.target.value))}>
          {[300, 600, 1000, 1500].map((v) => <option key={v} value={v}>{(v / 1000).toFixed(1)} {t("tts.sec")}</option>)}
        </select>
      </div>
      <span className="hint">{t("tts.hint")}</span>
      {msg && <span className="small muted">{msg}</span>}
      {preview && <audio controls src={preview} className="w-full mt-1" />}
    </div>
  );
}
