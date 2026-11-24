"use client";
import { useState, useTransition } from "react";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { readCriteriaFile, saveExamCriteria } from "@/lib/ai/criteria-actions";

/** Критерии ОГЭ и ЕГЭ (ФИПИ) — ИИ ставит баллы только по ним; без критериев — комментарии без баллов. */
export function ExamCriteria({ init }: { init: { oge: string; ege: string; at?: string } }) {
  const { t } = useT();
  const [v, setV] = useState({ oge: init.oge, ege: init.ege });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = (k: "oge" | "ege") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    setMsg(t("ec.reading"));
    start(async () => {
      const r = await readCriteriaFile(fd);
      if (r.ok) { setV((x) => ({ ...x, [k]: r.text })); setMsg(t("ec.loaded")); } else setMsg(t("ec.fileErr"));
    });
  };
  const box = (k: "oge" | "ege", label: string) => (
    <div className="field">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`ec-${k}`} className="m-0">{label}</label>
        <label className="btn plain sm"><Icon name="clip" size="sm" />{t("ec.upload")}<input type="file" accept=".txt,.md,.docx,.pdf" className="sr-only" onChange={load(k)} /></label>
      </div>
      <textarea id={`ec-${k}`} className="textarea" rows={6} value={v[k]} placeholder={t("ec.ph")} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      <span className="hint">{v[k].trim() ? t("ec.chars", { n: v[k].length }) : t("ec.none")}</span>
    </div>
  );
  return (
    <section className="card" id="exam-criteria">
      <h2 className="mb-1">{t("ec.title")}</h2>
      <p className="small muted mt-0 mb-4">{t("ec.lead")}</p>
      {box("oge", t("ec.oge"))}
      {box("ege", t("ec.ege"))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn primary" disabled={pending} onClick={() => start(async () => { const r = await saveExamCriteria(v); setMsg(r.ok ? t("ec.saved") : t("ai.err.fail")); })}>{t("common.save")}</button>
        {msg && <span className="small muted">{msg}</span>}
        <a className="alink small ml-auto" href="/teacher/ai-quality">{t("aq.title")} →</a>
      </div>
    </section>
  );
}
