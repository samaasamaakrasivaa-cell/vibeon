"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { flagItem } from "@/lib/placement/bank-actions";
import { Icon } from "../Icon";

/** «На проверку»: учитель отмечает вопрос, который стоит поправить; владелец банка видит пометки во вкладке «На проверку». */
export function Flag({ itemId, questions, attempt }: { itemId: string; questions?: { id: string }[]; attempt?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [qid, setQid] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (sent) return <span className="plflag sent"><Icon name="check" size="sm" />{t("pl.flagSent")}</span>;
  const send = async () => { setBusy(true); const r = await flagItem(itemId, note, qid || null, attempt).catch(() => null); setBusy(false); if (r?.ok) { setSent(true); setOpen(false); } };
  return (
    <div className="plflagwrap">
      <button type="button" className="plflag" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="flagI" size="sm" />{t("pl.flag")}</button>
      {open && (
        <div className="plflagbox">
          {questions && questions.length > 0 && (
            <select className="select" value={qid} onChange={(e) => setQid(e.target.value)} aria-label={t("pl.flagWhich")}>
              <option value="">{t("pl.flagWhole")}</option>
              {questions.map((q, i) => <option key={q.id} value={q.id}>{t("pl.flagQ", { n: i + 1 })}</option>)}
            </select>
          )}
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pl.flagPh")} />
          <div className="flex gap-2 justify-end"><button type="button" className="btn plain sm" onClick={() => setOpen(false)}>{t("common.cancel")}</button><button type="button" className="btn primary sm" disabled={busy} onClick={send}>{t("pl.flagSend")}</button></div>
        </div>
      )}
    </div>
  );
}

