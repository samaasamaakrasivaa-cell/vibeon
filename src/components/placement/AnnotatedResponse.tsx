"use client";
import { Fragment, useState } from "react";
import { applyEdits } from "@/lib/ai/check-core";
import type { ResponseEdit } from "@/lib/placement/ai-feedback";
import { useT } from "@/lib/i18n/client";
import type { Rubric } from "@/lib/placement/rubric";

export function AnnotatedResponse({ text, edits, criteria }: { text: string; edits: ResponseEdit[]; criteria: Rubric[] }) {
  const { t, lang } = useT();
  const [selected, select] = useState<number | null>(null);
  const active = edits.find((e) => e.start === selected);
  const name = (id: string) => {
    const c = criteria.find((x) => x.id === id);
    return lang === "en" ? c?.en || c?.name_ru : c?.name_ru;
  };
  let end = 0;
  return <div className="pl-annotated">
    <div className="tpassage plpassage">{edits.map((e) => {
      const preceding = text.slice(end, e.start);
      end = e.end;
      return <Fragment key={e.start}>{preceding}<button type="button" className="pl-error-mark"
        aria-pressed={selected === e.start} onPointerEnter={() => select(e.start)} onFocus={() => select(e.start)}
        onClick={() => select(e.start)} onKeyDown={(event) => { if (event.key === "Escape") select(null); }}
        title={`${e.corrected || t("pl.removeFragment")} · ${name(e.criterion)} · ${e.explanation}`}>{e.original}</button></Fragment>;
    })}{text.slice(end)}</div>
    {active && <div className="pl-correction" aria-live="polite"><strong>{name(active.criterion)}</strong>
      <span><del>{active.original}</del> → <b>{active.corrected || t("pl.removeFragment")}</b></span>
      <span>{active.explanation}</span></div>}
    {!!edits.length && <details><summary className="small">{t("pl.correctedText")}</summary><div className="tpassage plpassage">{applyEdits(text, edits)}</div></details>}
  </div>;
}
