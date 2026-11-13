"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { fmtTime, parseTime, videoEmbed } from "@/lib/tasks/parse";
import { Icon } from "../Icon";

/** Отрывок видео: плеер для предпросмотра, кнопки «Начало здесь / Конец здесь» по текущему месту, бегунки (перематывают плеер) и поля «мм:сс».
 *  YouTube — через его плеер (postMessage: длина, текущее время, перемотка); файл — через <video>; Rutube и VK — только бегунки и поля. */
export function VideoClip({ src, start, end, onChange }: { src: string; start?: number; end?: number; onChange: (v: { clipStart?: number; clipEnd?: number }) => void }) {
  const { t } = useT();
  const v = videoEmbed(src);
  const [dur, setDur] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [manual, setManual] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const yt = v?.host === "youtube" ? /embed\/([\w-]{11})/.exec(v.src)?.[1] : null;

  // YouTube: плеер присылает infoDelivery с duration и currentTime, если «подписаться» сообщением listening
  useEffect(() => {
    setDur(null); setNow(null);
    if (!yt) return;
    const onMsg = (e: MessageEvent) => {
      let host = "";
      try { host = new URL(e.origin).hostname; } catch { return; }
      if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return;
      try {
        const d = JSON.parse(String(e.data));
        const i = d?.info ?? {};
        if (typeof i.duration === "number" && i.duration > 0) setDur(Math.round(i.duration));
        if (typeof i.currentTime === "number") setNow(i.currentTime);
      } catch { /* не JSON */ }
    };
    window.addEventListener("message", onMsg);
    const ping = setInterval(() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "clip", channel: "widget" }), "*"), 1000);
    return () => { window.removeEventListener("message", onMsg); clearInterval(ping); };
  }, [yt]);

  if (!v) return null;
  const max = dur ?? (Number(manual) > 0 ? Math.round(Number(manual) * 60) : Math.max(3600, end ?? 0));
  const s = Math.min(start ?? 0, max), e = Math.min(end && end > s ? end : max, max);
  const set = (a: number, b: number) => onChange({ clipStart: a > 0 ? Math.round(a) : undefined, clipEnd: b < max || (dur === null && end) ? Math.round(b) : undefined });
  const seek = (x: number) => {
    if (video.current) video.current.currentTime = x;
    if (yt) frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [x, true] }), "*");
  };
  const canMark = now !== null; // текущее место известно — можно ставить начало и конец по плееру
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
      {/* плеер для предпросмотра: смотрите и отмечайте начало и конец */}
      {yt && <iframe ref={frame} src={`https://www.youtube.com/embed/${yt}?enablejsapi=1&rel=0`} title={t("bld.clip")} className="vclip-player" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />}
      {v.kind === "file" && <video ref={video} src={src} controls preload="metadata" className="vclip-player"
        onLoadedMetadata={(ev) => { const x = ev.currentTarget.duration; if (Number.isFinite(x) && x > 0) setDur(Math.round(x)); }}
        onTimeUpdate={(ev) => setNow(ev.currentTarget.currentTime)} />}
      {(yt || v.kind === "file") && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn secondary sm" disabled={!canMark} onClick={() => set(Math.min(now!, e - 1), e)}>⟦ {t("bld.clipMarkStart")}</button>
          <button type="button" className="btn secondary sm" disabled={!canMark} onClick={() => set(s, Math.max(now!, s + 1))}>{t("bld.clipMarkEnd")} ⟧</button>
          <span className="small muted">{canMark ? t("bld.clipNow", { t: fmtTime(now!) }) : t("bld.clipPlay")}</span>
        </div>
      )}
      <div className="vclip-range">
        <input type="range" min={0} max={max} step={1} value={s} onChange={(ev) => { const x = Math.min(Number(ev.target.value), e - 1); set(x, e); seek(x); }} aria-label={t("bld.clipFrom")} />
        <input type="range" min={0} max={max} step={1} value={e} onChange={(ev) => { const x = Math.max(Number(ev.target.value), s + 1); set(s, x); seek(x); }} aria-label={t("bld.clipTo")} />
        <div className="vclip-sel" style={{ left: `${(s / max) * 100}%`, right: `${100 - (e / max) * 100}%` }} />
        {now !== null && <div className="vclip-now" style={{ left: `${Math.min(100, (now / max) * 100)}%` }} />}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {field(s, (x) => { set(Math.min(x, e - 1), e); seek(x); }, t("bld.clipFrom"))}
        {field(e, (x) => { set(s, Math.max(x, s + 1)); seek(x); }, t("bld.clipTo"))}
        <span className="small muted pb-2">{dur ? t("bld.clipLen", { d: fmtTime(dur) }) : null}</span>
        {(start || end) ? <button type="button" className="btn plain sm" onClick={() => seek(s)}><Icon name="sound" size="sm" />{t("bld.clipFromStart")}</button> : null}
      </div>
      {!dur && v.kind !== "file" && (
        <label className="flex items-center gap-2 small muted">{t("bld.clipManual")}<input className="input" style={{ width: 80 }} inputMode="numeric" value={manual} onChange={(ev) => setManual(ev.target.value.replace(/[^\d]/g, ""))} /></label>
      )}
      {!v.endOk && <p className="small muted m-0">{t("bld.clipNoEnd")}</p>}
    </div>
  );
}
