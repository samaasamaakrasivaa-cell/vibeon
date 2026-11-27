"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";

const MINUTE_MS = 60_000;

export function NextLessonCountdown({ startsAt, initialNow, timezone }: {
  startsAt: number | null;
  initialNow: number;
  timezone: string;
}) {
  const { lang, t } = useT();
  const [now, setNow] = useState(initialNow);

  useEffect(() => {
    if (startsAt === null) return;

    let timeout: number | undefined;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const remaining = startsAt - current;
      if (remaining > 0) {
        timeout = window.setTimeout(tick, remaining % MINUTE_MS || MINUTE_MS);
      }
    };
    tick();
    return () => window.clearTimeout(timeout);
  }, [startsAt]);

  if (startsAt !== null && startsAt <= now) return null;

  const date = startsAt === null ? null : new Date(startsAt);
  const minutes = date ? Math.ceil((date.getTime() - now) / MINUTE_MS) : 0;
  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const relative = new Intl.RelativeTimeFormat(locale, { style: "short" });
  const countdown = minutes < 60
    ? t("today.startsIn", { n: minutes })
    : minutes < 1_440
      ? relative.format(Math.floor(minutes / 60), "hour")
      : relative.format(Math.floor(minutes / 1_440), "day");

  return (
    <section className="card sm flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h2 className="m-0 text-base">{t("prof.nextLesson")}</h2>
      {date ? (
        <>
          <time dateTime={date.toISOString()}>
            {date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone })}
          </time>
          <span className="text-text2 tabular-nums">{countdown}</span>
        </>
      ) : <span className="text-text2">{t("today.noNext")}</span>}
    </section>
  );
}
