"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useT } from "@/lib/i18n/client";
import { RUB_V2 } from "@/lib/placement/rubric";
import { changeWsTeacherAssessment } from "@/lib/placement/ws-teacher-actions";
import type { wsTeacherDecisionView } from "@/lib/placement/ws-teacher-write";

export type WsTeacherDecisionView = NonNullable<ReturnType<typeof wsTeacherDecisionView>>;

export function WsTeacherDecision({ id, kind, view }: { id: string; kind: "writing" | "speaking"; view: WsTeacherDecisionView }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const criteria = RUB_V2[kind];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const decision = view.confirmed ? { type: "reopen" as const } : {
      type: "confirm" as const,
      marks: Object.fromEntries(criteria.map(({ id }) => [id, Number(data.get(id))])),
      note: String(data.get("note") ?? ""),
    };
    setBusy(true);
    setError("");
    try {
      const result = await changeWsTeacherAssessment(id, kind, view.expected, decision);
      if (result === "saved") router.refresh();
      else if (result === "empty") setError(t(kind === "speaking" ? "pl.noRec" : "pl.noAnswer"));
      else setError(t("pl.wsDecisionChanged"));
    } catch {
      setError(t("pl.err.net"));
    } finally {
      setBusy(false);
    }
  }

  if (!view.hasAnswer) return <p className="small muted">{t(kind === "speaking" ? "pl.noRec" : "pl.noAnswer")}</p>;
  return (
    <form className="plrub flex flex-col gap-2" onSubmit={submit}>
      <b>{t(view.confirmed ? "pl.wsTeacherConfirmed" : "pl.wsTeacherDecision")}</b>
      {!view.confirmed && criteria.map(({ id, name_ru, en }) => (
        <label key={id} className="flex items-center justify-between gap-2 small">
          {lang === "en" ? en ?? name_ru : name_ru}
          <select name={id} className="select" required defaultValue={view.draft?.[id] ?? ""}>
            <option value="">—</option>
            {Array.from({ length: RUB_V2.max + 1 }, (_, score) => <option key={score} value={score}>{score}</option>)}
          </select>
        </label>
      ))}
      {!view.confirmed && <label className="field small">{t("pl.scoreNote")}<textarea name="note" className="textarea" rows={2} maxLength={2000} /></label>}
      <button type="submit" className="btn secondary sm self-start" disabled={busy}>
        {t(view.confirmed ? "pl.wsTeacherReopen" : "pl.wsTeacherConfirm")}
      </button>
      {error && <p className="small m-0" role="alert">{error}</p>}
    </form>
  );
}
