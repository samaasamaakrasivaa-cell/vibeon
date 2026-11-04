"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { setStudentPace, startStageTest } from "@/lib/roadmap/actions";
import { etaRange, PACES, paceKey, weeksFor } from "@/lib/roadmap/math";
import { Icon } from "../Icon";
import { Mountain } from "./Mountain";

/** Выбор темпа: прогноз по каждому варианту, метки «твой темп» и «учитель рекомендует». */
export function PacePicker({ left, current, teacher, lessonMin, showDate }: { left: number; current: string; teacher: string; lessonMin: number; showDate: boolean }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cur, setCur] = useState(current);
  const base = weeksFor(left, PACES.find((p) => paceKey(p) === cur) ?? PACES[2], lessonMin);
  return (
    <div className="paces">
      {PACES.map((p) => {
        const k = paceKey(p), d = Math.round(weeksFor(left, p, lessonMin) - base);
        return (
          <button key={k} type="button" className={`pace ${k === cur ? "on" : ""}`} disabled={pending} aria-pressed={k === cur}
            onClick={() => { setCur(k); start(async () => { await setStudentPace(k); setTimeout(() => router.refresh(), 0); }); }}>
            <b>{lang === "ru" ? `${p.lessons} ${p.lessons === 1 ? "урок" : "урока"} в неделю` : `${p.lessons} ${p.lessons === 1 ? "lesson" : "lessons"} a week`}</b>
            <small>+ {p.min} {t("rt.minSelf")}</small>
            <span>{showDate ? etaRange(left, p, lang, lessonMin) : t("rt.weeks", { n: Math.max(1, Math.round(weeksFor(left, p, lessonMin))) })}</span>
            {k === teacher && <em className="dl rec">{t("rt.teacherRec")}</em>}
            {k === cur ? <em className="dl now">{t("rt.yourPace")}</em> : d < 0 ? <em className="dl up">{t("rt.earlier", { n: -d })}</em> : d > 0 ? <em className="dl down">{t("rt.later", { n: d })}</em> : null}
          </button>
        );
      })}
    </div>
  );
}

export function StageTestButton({ stage, enabled, final }: { stage: number; enabled: boolean; final: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button className={`btn sm ${enabled ? "primary" : "secondary"}`} disabled={!enabled || pending} title={enabled ? undefined : t("rt.testLocked")}
      onClick={() => start(async () => { const r = await startStageTest(stage); if (r.ok && r.id) router.push(`/student/test/${r.id}`); })}>
      <Icon name={enabled ? "targetI" : "lockI"} size="sm" />{final ? t("rt.finalTest") : t("rt.sliceTest")}
    </button>
  );
}

/** Карта с выбором этапа: клик по флажку — подробности этапа. */
export function RouteMap(p: React.ComponentProps<typeof Mountain> & { links?: boolean }) {
  const router = useRouter();
  return <Mountain {...p} onSelect={(i) => router.push(`?tab=stage&i=${i}`, { scroll: false })} />;
}
