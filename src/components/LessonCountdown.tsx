"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";

const MINUTE_MS = 60_000;
// The Teacher card entered its “soon” state when Math.round(minutes) was at most 60.
const TEACHER_WINDOW_MS = 60.5 * MINUTE_MS;
const DAY_MINUTES = 1_440;
const unitLabels = {
  day: "lessonCountdown.day",
  hour: "lessonCountdown.hour",
  minute: "lessonCountdown.minute",
} as const;

type Unit = keyof typeof unitLabels;
type CountdownProps = {
  startsAt: number;
  initialNow: number;
  variant: "teacher" | "student";
};

function FlipDigit({ digit }: { digit: string }) {
  const [flip, setFlip] = useState({ digit, previous: null as string | null, sequence: 0 });
  if (flip.digit !== digit) {
    setFlip({ digit, previous: flip.digit, sequence: flip.sequence + 1 });
  }

  return (
    <span className="lcd-tile" data-digit={digit} data-flipping={flip.previous === null ? undefined : "true"}>
      <span className="lcd-face lcd-top"><span>{digit}</span></span>
      <span className="lcd-face lcd-bottom"><span>{digit}</span></span>
      {flip.previous !== null && (
        <span className="lcd-motion" key={flip.sequence}>
          <span className="lcd-face lcd-bottom lcd-hold"><span>{flip.previous}</span></span>
          <span className="lcd-face lcd-top lcd-fold"><span>{flip.previous}</span></span>
          <span className="lcd-face lcd-bottom lcd-unfold" onAnimationEnd={() => {
            setFlip((current) => current.sequence === flip.sequence ? { ...current, previous: null } : current);
          }}><span>{digit}</span></span>
        </span>
      )}
    </span>
  );
}

export function LessonCountdown({ startsAt, initialNow, variant }: CountdownProps) {
  const router = useRouter();
  const [now, setNow] = useState(initialNow);
  const refreshedTargets = useRef(new Set<number>());

  useEffect(() => {
    let timeout: number | undefined;
    const tick = () => {
      window.clearTimeout(timeout);
      const current = Date.now();
      setNow(current);
      const remaining = startsAt - current;
      if (remaining <= 0) {
        if (!refreshedTargets.current.has(startsAt)) {
          refreshedTargets.current.add(startsAt);
          router.refresh();
        }
        return;
      }
      const untilVisible = variant === "teacher" ? remaining - TEACHER_WINDOW_MS + 1 : 0;
      timeout = window.setTimeout(tick, Math.max(1, untilVisible > 0 ? untilVisible : remaining % MINUTE_MS || MINUTE_MS));
    };
    const resume = () => {
      if (!document.hidden) tick();
    };
    tick();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [router, startsAt, variant]);

  const remaining = startsAt - Math.max(now, initialNow);
  const visible = remaining > 0 && (variant === "student" || remaining < TEACHER_WINDOW_MS);
  return visible && (
    <CountdownFace key={startsAt} startsAt={startsAt} initialNow={initialNow} variant={variant} remaining={remaining} />
  );
}

function CountdownFace({ startsAt, initialNow, variant, remaining }: CountdownProps & { remaining: number }) {
  const { lang, t } = useT();
  const [initialMinutes] = useState(() => Math.ceil((startsAt - initialNow) / MINUTE_MS));
  const dayDigits = Math.max(2, String(Math.floor(initialMinutes / DAY_MINUTES)).length);
  const minutes = Math.ceil(remaining / MINUTE_MS);
  const prefix = t(variant === "teacher" ? "lessonCountdown.teacher" : "lessonCountdown.student");
  const units: [Unit, number][] = [];
  if (variant === "teacher") {
    units.push(["minute", Math.min(minutes, 60)]);
  } else {
    const days = Math.floor(minutes / DAY_MINUTES);
    if (initialMinutes >= DAY_MINUTES || days > 0) units.push(["day", days]);
    if (initialMinutes >= 60 || minutes >= 60) units.push(["hour", Math.floor(minutes / 60) % 24]);
    units.push(["minute", minutes % 60]);
  }
  const accessible = units.filter(([unit, value]) => unit === "minute" || value > 0).map(([unit, value]) =>
    new Intl.NumberFormat(lang, { style: "unit", unit, unitDisplay: "long" }).format(value)
  ).join(", ");

  return (
    <time className={`lesson-countdown lesson-countdown--${variant}`} role="timer"
      dateTime={new Date(startsAt).toISOString()} aria-label={`${prefix} ${accessible}`}>
      <span className="lcd-prefix" aria-hidden="true">{prefix}</span>
      <span className="lcd-units" aria-hidden="true">
        {units.map(([unit, value]) => (
          <span className="lcd-unit" key={unit} data-unit={unit}>
            {String(value).padStart(unit === "day" ? dayDigits : 2, "0").split("").map((digit, index) => <FlipDigit key={index} digit={digit} />)}
            <span className="lcd-unit-label">{t(unitLabels[unit])}</span>
          </span>
        ))}
      </span>
    </time>
  );
}
