"use client";
import { useEffect, useState } from "react";

/** Карточка «день + часы» как в прототипе. */
export function Clock({ lang, tz }: { lang: "ru" | "en"; tz: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const d = now ?? new Date(0);
  // Время и дата — в часовом поясе пользователя, а не браузера
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleString(loc, { ...o, timeZone: tz });
  const wd = part({ weekday: "short" }).replace(".", "").toUpperCase();
  const month = part({ day: "numeric", month: "long" }).replace(/^\d+\s*/, "");
  const day = Number(part({ day: "numeric" }));
  const [hh, mm, ss] = d.toLocaleTimeString("en-GB", { timeZone: tz, hourCycle: "h23" }).split(":").map(Number);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="flex overflow-hidden rounded-[20px] border border-sep bg-surface" style={{ visibility: now ? "visible" : "hidden", boxShadow: "var(--shadow)" }}>
      <div className="flex min-w-[86px] flex-col items-center justify-center border-r border-sep px-5 py-3">
        <span className="text-[13px] font-bold tracking-wide text-bad">{wd}</span>
        <span className="text-[34px] leading-tight font-medium">{day}</span>
        <span className="text-[11px] text-text3">{month}</span>
      </div>
      <div className="flex items-baseline px-6 py-3" style={{ fontVariantNumeric: "tabular-nums", background: "linear-gradient(135deg,var(--surface),var(--accent-bg))" }}>
        <span className="self-center text-[46px] font-medium tracking-tight">
          {p(hh)}
          <span className="text-text3">:</span>
          {p(mm)}
        </span>
        <span className="ml-2 self-center text-[15px] text-accent">{p(ss)}</span>
      </div>
    </div>
  );
}
