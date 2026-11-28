"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useT } from "@/lib/i18n/client";
import { confirmPlacementLevel } from "@/lib/placement/level-confirmation-actions";
import type { placementLevelView } from "@/lib/placement/level-confirmation";
import { STEPS } from "@/lib/placement/engine";

type View = NonNullable<Awaited<ReturnType<typeof placementLevelView>>>;
type Fact = View["facts"][number];

const groups = {
  grammar: "pl.part.core", vocabulary: "pl.part.vocab", reading: "pl.part.reading",
  listening: "pl.part.listening", writing: "pl.part.writing", speaking: "pl.part.speaking",
} as const;
const gaps = {
  "not-tested": "pl.levelFactUntested", "not-confirmed": "pl.levelFactUnconfirmed", "unknown-origin": "pl.levelFactUnverified",
} as const;
const scopeNames = {
  initial: "pl.levelFactInitial", additional: "pl.levelFactAdditional", reassessment: "pl.levelFactReassessment",
  "teacher-adjustment": "pl.levelFactAdjusted",
} as const;
const group = (fact: Fact) => "topicId" in fact && fact.topicId ? fact.topicId : fact.skill;

export function PlacementLevelConfirmation({ id, view }: { id: string; view: View }) {
  const { t } = useT();
  const router = useRouter();
  const [level, setLevel] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const step = STEPS.find((value) => value === level);
    if (busy || !step) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await confirmPlacementLevel(id, {
        level: step, factIds: Object.values(selected).filter(Boolean), revision: view.revision, previousVersion: view.previousVersion,
      });
      if (result === "saved" || result === "unchanged") {
        setMessage(t("pl.levelSaved"));
      } else {
        setMessage(t("pl.wsDecisionChanged"));
      }
    } catch {
      setMessage(t("pl.err.net"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card flex flex-col gap-3" onSubmit={submit}>
      <h3 className="m-0">{t("pl.levelRoadmap")}</h3>
      {view.suggestedLevel && <p className="small m-0">{t("pl.finalHint", { h: view.suggestedLevel })}</p>}
      <div className="flex flex-col gap-1">
        {view.facts.map((fact) => {
          if (fact.status === "unknown") return <p className="small muted m-0" key={fact.factId}>{t(groups[fact.skill])} · {t(gaps[fact.reason])}</p>;
          const key = group(fact);
          const label = [
            "topicId" in fact && fact.topicId ? fact.topicId : t(groups[fact.skill]), t(scopeNames[fact.scope]),
            "correct" in fact ? `${fact.correct}/${fact.total}` : null, fact.level,
          ].filter(Boolean).join(" · ");
          return fact.selectable
            ? <label className="small flex gap-2" key={fact.factId}><input type="checkbox" checked={selected[key] === fact.factId}
                onChange={(event) => setSelected({ ...selected, [key]: event.target.checked ? fact.factId : "" })} />{label}</label>
            : <p className="small m-0" key={fact.factId}>{label}</p>;
        })}
      </div>
      <label className="field small">{t("pl.finalLevel")}
        <select className="select" required value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="">—</option>{STEPS.map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn primary sm" disabled={busy || !level}>{t("pl.levelConfirm")}</button>
        <button type="button" className="btn plain sm" onClick={() => router.refresh()}>{t("pl.levelRefresh")}</button>
      </div>
      {message && <p className="small m-0" role="status">{message}</p>}
    </form>
  );
}
