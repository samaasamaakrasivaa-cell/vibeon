"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { flagItem } from "@/lib/placement/bank-actions";
import { Icon } from "../Icon";

/** «Указать на ошибку»: учитель отмечает задание (qid — конкретный вопрос текста), владелец банка видит пометки во вкладке «Указали на ошибку». */
export function Flag({ itemId, qid, attempt, small }: { itemId: string; qid?: string; attempt?: string; small?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (sent) return <span className="plflag sent"><Icon name="check" size="sm" />{t("pl.flagSent")}</span>;
  const send = async () => { setBusy(true); const r = await flagItem(itemId, note, qid || null, attempt).catch(() => null); setBusy(false); if (r?.ok) { setSent(true); setOpen(false); } };
  return (
    <div className="plflagwrap">
      <button type="button" className={`plflag ${small ? "sm" : ""}`} aria-expanded={open} title={t("pl.flag")} aria-label={t("pl.flag")} onClick={() => setOpen(!open)}><Icon name="flagI" size="sm" />{!small && t("pl.flag")}</button>
      {open && (
        <div className="plflagbox">
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pl.flagPh")} />
          <div className="flex gap-2 justify-end"><button type="button" className="btn plain sm" onClick={() => setOpen(false)}>{t("common.cancel")}</button><button type="button" className="btn primary sm" disabled={busy} onClick={send}>{t("pl.flagSend")}</button></div>
        </div>
      )}
    </div>
  );
}

