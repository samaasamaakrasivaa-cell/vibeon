"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { fmtTime, parseTime, videoEmbed } from "@/lib/tasks/parse";
import { Icon } from "../Icon";

/** Отрывок видео: бегунки начала и конца + поля «мм:сс». Длину ролика узнаём сами (файл — по метаданным, YouTube — через плеер). */
export function VideoClip({ src, start, end, onChange }: { src: string; start?: number; end?: number; onChange: (v: { clipStart?: number; clipEnd?: number }) => void }) {
  const { t } = useT();
  const v = videoEmbed(src);
  const [dur, setDur] = useState<number | null>(null);
  const [manual, setManual] = useState("");
  const probe = useRef<HTMLIFrameElement>(null);

  // длина ролика YouTube: плеер с enablejsapi присылает infoDelivery с duration
  const yt = v?.host === "youtube" ? /embed\/([\w-]{11})/.exec(v.src)?.[1] : null;
  useEffect(() => {
    setDur(null);
    if (!yt) return;
    const onMsg = (e: MessageEvent) => {
      if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
      try { const d = JSON.parse(String(e.data)); const x = d?.info?.duration; if (typeof x === "number" && x > 0) setDur(Math.round(x)); } catch { /* не JSON */ }
    };
    window.addEventListener("message", onMsg);
    const ping = setInterval(() => probe.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "clip", channel: "widget" }), "*"), 700);
    const stop = setTimeout(() => clearInterval(ping), 15000);
    return () => { window.removeEventListener("message", onMsg); clearInterval(ping); clearTimeout(stop); };
  }, [yt]);

  if (!v) return null;
  const max = dur ?? (Number(manual) > 0 ? Math.round(Number(manual) * 60) : Math.max(3600, end ?? 0));
  const s = Math.min(start ?? 0, max), e = Math.min(end && end > s ? end : max, max);
  const set = (a: number, b: number) => onChange({ clipStart: a > 0 ? a : undefined, clipEnd: b < max || (dur === null && end) ? b : undefined });
  const field = (val: number, put: (x: number) => void, label: string) => (
    <label className="vclip-f"><span className="small muted">{label}</span>
      <input className="input" defaultValue={fmtTime(val)} key={val} onBlur={(ev) => { const x = parseTime(ev.target.value); if (Number.isFinite(x)) put(Math.max(0, Math.min(max, x))); }} aria-label={label} />
    </label>
  );
  return (
    <div className="vclip">
      <div className="flex items-center gap-2"><Icon name="clock" size="sm" /><b className="small grow">{t("bld.clip")}</b>
        {(start || end) ? <button type="button" className="btn plain sm" onClick={() => onChange({ clipStart: undefined, clipEnd: undefined })}>{t("bld.clipAll")}</button> : null}
      </div>
      {yt && <iframe ref={probe} src={`https://www.youtube.com/embed/${yt}?enablejsapi=1`} title="probe" className="vclip-probe" aria-hidden="true" tabIndex={-1} />}
      {v.kind === "file" && <video src={src} preload="metadata" className="vclip-probe" onLoadedMetadata={(ev) => { const x = ev.currentTarget.duration; if (Number.isFinite(x) && x > 0) setDur(Math.round(x)); }} />}
      <div className="vclip-range">
        <input type="range" min={0} max={max} step={1} value={s} onChange={(ev) => set(Math.min(Number(ev.target.value), e - 1), e)} aria-label={t("bld.clipFrom")} />
        <input type="range" min={0} max={max} step={1} value={e} onChange={(ev) => set(s, Math.max(Number(ev.target.value), s + 1))} aria-label={t("bld.clipTo")} />
        <div className="vclip-sel" style={{ left: `${(s / max) * 100}%`, right: `${100 - (e / max) * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {field(s, (x) => set(Math.min(x, e - 1), e), t("bld.clipFrom"))}
        {field(e, (x) => set(s, Math.max(x, s + 1)), t("bld.clipTo"))}
        <span className="small muted pb-2">{dur ? t("bld.clipLen", { d: fmtTime(dur) }) : null}</span>
      </div>
      {!dur && v.kind !== "file" && (
        <label className="flex items-center gap-2 small muted">{t("bld.clipManual")}<input className="input" style={{ width: 80 }} inputMode="numeric" value={manual} onChange={(ev) => setManual(ev.target.value.replace(/[^\d]/g, ""))} /></label>
      )}
      {!v.endOk && <p className="small muted m-0">{t("bld.clipNoEnd")}</p>}
    </div>
  );
}
