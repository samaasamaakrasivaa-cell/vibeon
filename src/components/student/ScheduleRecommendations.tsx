"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/Icon";
import { useT } from "@/lib/i18n/client";
import { fmtHM } from "@/lib/roadmap/math";
import { confirmStudyWeek, proposeStudyWeek } from "@/lib/study/actions";
import { KIND } from "@/lib/study/kinds";
import { activityKind, type DraftSlot, type StudyRecommendation, type WeekDraft } from "@/lib/study/weekly-plan";

type Day = { iso: string; long: string; past: boolean };
const timeText = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function ScheduleRecommendations({ plan, days }: { plan: StudyRecommendation; days: Day[] }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [draft, setDraft] = useState<WeekDraft | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const monday = days[0].iso;
  const canSuggest = !days.every((day) => day.past) && plan.items.some(({ skill }) => skill !== "vocabulary");
  const errorText = (code: string) => t(code === "overlap" ? "st.draftOverlap" : code === "plan" ? "st.draftChanged" : code === "past" ? "st.draftPast" : "st.err");

  const propose = () => start(async () => {
    setError("");
    setSaved(false);
    try {
      const result = await proposeStudyWeek(monday);
      if (result.ok) setDraft(result);
      else setError(errorText(result.error));
    } catch {
      setError(t("st.err"));
    }
  });

  const confirm = () => {
    if (!draft) return;
    start(async () => {
      setError("");
      try {
        const result = await confirmStudyWeek(monday, draft.revision, draft.slots);
        if (result.ok) {
          setDraft(null);
          setSaved(true);
          router.refresh();
        } else setError(errorText(result.error));
      } catch {
        setError(t("st.err"));
      }
    });
  };

  const update = (index: number, patch: Partial<DraftSlot>) => {
    setDraft((current) => current && { ...current, slots: current.slots.map((slot, i) => i === index ? { ...slot, ...patch } : slot) });
  };
  const remove = (index: number) => setDraft((current) => current && { ...current, slots: current.slots.filter((_, i) => i !== index) });
  const close = () => { if (!pending) { setDraft(null); setError(""); } };
  const invalidDraft = draft?.slots.some(({ startMin, durMin }) => !Number.isInteger(startMin) || !Number.isInteger(durMin) ||
    startMin < 0 || durMin < 5 || durMin > 240 || startMin % 5 !== 0 || durMin % 5 !== 0 || startMin + durMin > 1440);

  return (
    <div id="study-recommendations" className="mt-5 pt-4 border-t border-sep scroll-mt-24">
      <div className="flex flex-wrap gap-2 justify-between items-baseline">
        <h3 className="m-0">{t("st.routeRecommendations")}</h3>
        <b>{t("st.weekTime", { amount: fmtHM(plan.minutes / 60, lang) })}</b>
      </div>
      <ul className="strecs">
        {plan.items.map((item, index) => {
          const kind = activityKind(item.skill, item.activity);
          return (
            <li key={index} className="strec">
              <span className="stdot shrink-0" style={{ background: KIND[kind ?? "words"].color }} />
              <span className="grow min-w-0">
                <b className="break-words">{item.activity}</b>
                {!kind && <Link className="small alink block mt-1" href="/student/words?goal=1">{t("st.planWords")}</Link>}
              </span>
              <span className="small muted shrink-0">{item.times} × {item.minutes} {t("dash.min")}</span>
            </li>
          );
        })}
      </ul>
      {canSuggest && <button type="button" className="btn tinted" onClick={propose} disabled={pending}><Icon name="cal" size="sm" />{t("st.distributeWeek")}</button>}
      {!draft && error && <p className="text-bad small mb-0" role="alert">{error}</p>}
      {saved && <p className="text-ok small mb-0" role="status">{t("st.draftSaved")}</p>}
      {draft && (
        <Dialog open onClose={close} title={t("st.distributeWeek")}>
          <p className="muted mt-0">{t(draft.slots.length ? "st.draftLead" : draft.missed ? "st.draftNoSpace" : "st.draftEmpty")}</p>
          {draft.missed > 0 && draft.slots.length > 0 && <p className="small muted">{t("st.draftMissed", { n: draft.missed })}</p>}
          <div className="flex flex-col gap-3">
            {draft.slots.map((slot, index) => (
              <fieldset key={index} className="tile min-w-0">
                <legend className="font-semibold break-words">{slot.title}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                  <label className="field min-w-0 col-span-2 sm:col-span-1">
                    <span className="flabel">{t("st.day")}</span>
                    <select className="select" value={slot.day} onChange={(event) => update(index, { day: Number(event.target.value) })}>
                      {days.map((day, i) => <option key={day.iso} value={i} disabled={day.past}>{day.long}</option>)}
                    </select>
                  </label>
                  <label className="field"><span className="flabel">{t("st.time")}</span>
                    <input className="input" type="time" step={300} value={Number.isFinite(slot.startMin) ? timeText(slot.startMin) : ""} onChange={(event) => {
                      const [hour, minute] = event.target.value.split(":").map(Number);
                      update(index, { startMin: hour * 60 + minute });
                    }} />
                  </label>
                  <label className="field"><span className="flabel">{t("ss.minutes")}</span>
                    <input className="input w-24" type="number" min={5} max={240} step={5} value={Number.isFinite(slot.durMin) ? slot.durMin : ""} onChange={(event) => update(index, { durMin: event.target.valueAsNumber })} />
                  </label>
                  <button type="button" className="iconbtn self-end" aria-label={t("common.delete")} onClick={() => remove(index)} disabled={pending}><Icon name="close" size="sm" /></button>
                </div>
              </fieldset>
            ))}
          </div>
          {error && <p className="text-bad small" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="btn secondary" onClick={close} disabled={pending}>{t("common.cancel")}</button>
            {draft.slots.length > 0 && <button type="button" className="btn primary" onClick={confirm} disabled={pending || invalidDraft}>{t("st.confirmDraft")}</button>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
