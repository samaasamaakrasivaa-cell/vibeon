"use client";
import { wordDiff } from "@/lib/ai/diff";
import { useT } from "@/lib/i18n/client";
import { Icon } from "../Icon";

export type AiCheck = { source?: string; corrected: string; notes: { from: string; to: string; why: string }[]; summary: string; verdict?: "ok" | "partly" | "wrong" };

/** Отметки в тексте ученика: зачёркнуто — ошибка, зелёным — как надо; ниже — пояснения и общий отзыв. */
export function AiMarks({ source, corrected }: { source: string; corrected: string }) {
  return (
    <div className="aimarks">
      {wordDiff(source, corrected).map((p, i) => (p.k === "same" ? <span key={i}>{p.t}</span> : p.k === "del" ? <del key={i}>{p.t}</del> : <ins key={i}>{p.t}</ins>))}
    </div>
  );
}

export function AiCheckView({ check, edit, onChange }: { check: AiCheck; edit?: boolean; onChange?: (c: AiCheck) => void }) {
  const { t } = useT();
  const source = check.source ?? "";
  return (
    <div className="aicheck">
      <div className="aicheck-h"><span className="tk-aiico"><Icon name="spark" size="sm" /></span><b>{t("ai.checkTitle")}</b>
        {check.verdict && <span className={`pill ${check.verdict === "ok" ? "green" : check.verdict === "partly" ? "orange" : "red"}`}>{t(`ai.v.${check.verdict}`)}</span>}
      </div>
      {source && <AiMarks source={source} corrected={check.corrected} />}
      {edit && (
        <div className="field mt-2">
          <label className="small muted" htmlFor="ai-corr">{t("ai.corrected")}</label>
          <textarea id="ai-corr" className="textarea" value={check.corrected} onChange={(e) => onChange?.({ ...check, corrected: e.target.value })} />
        </div>
      )}
      {check.notes.length > 0 && (
        <ul className="ainotes">
          {check.notes.map((n, i) => (
            <li key={i}>
              <span><del>{n.from}</del> → <ins>{n.to}</ins>{n.why && <span className="muted"> — {n.why}</span>}</span>
              {edit && <button type="button" className="iconbtn" aria-label={t("common.delete")} onClick={() => onChange?.({ ...check, notes: check.notes.filter((_, j) => j !== i) })}>✕</button>}
            </li>
          ))}
        </ul>
      )}
      {edit ? (
        <div className="field mt-2">
          <label className="small muted" htmlFor="ai-sum">{t("ai.summary")}</label>
          <textarea id="ai-sum" className="textarea" style={{ minHeight: 70 }} value={check.summary} onChange={(e) => onChange?.({ ...check, summary: e.target.value })} />
        </div>
      ) : check.summary && <p className="mb-0 mt-2">{check.summary}</p>}
    </div>
  );
}
