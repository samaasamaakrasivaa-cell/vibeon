"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon";
import { Dialog } from "../Dialog";
import { upload } from "../courses/CourseView";
import { useT } from "@/lib/i18n/client";
import { attachReceipt, cancelInvoice, closeInvoice, markPaid, rejectProof, resendInvoice, savePayDetails, undoAuto } from "@/lib/billing/actions";

type Res = { ok: boolean; error?: string };
function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const act = (fn: () => Promise<Res>) => start(async () => { setErr(null); const r = await fn(); if (!r.ok) setErr(r.error ?? "Error"); setTimeout(() => router.refresh(), 0); });
  return { pending, err, act };
}

export function CheckActions({ id, kind }: { id: string; kind: "waiting" | "toCheck" | "auto" }) {
  const { t } = useT();
  const { pending, err, act } = useAct();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {kind === "auto" ? (
        <>
          <button className="btn primary sm" disabled={pending} onClick={() => act(() => closeInvoice(id))}>OK</button>
          <button className="btn secondary sm" disabled={pending} onClick={() => act(() => undoAuto(id))}>{t("common.cancel")}</button>
        </>
      ) : (
        <>
          <button className="btn primary sm" disabled={pending} onClick={() => act(() => markPaid(id))}><Icon name="check" size="sm" />{t("pay.markPaid")}</button>
          {kind === "toCheck" && <button className="btn secondary sm" disabled={pending} onClick={() => act(() => rejectProof(id, ""))}>{t("pay.notFound")}</button>}
          <button className="iconbtn" title={t("pay.cancelInvoice")} aria-label={t("pay.cancelInvoice")} disabled={pending} onClick={() => confirm(t("pay.cancelQ")) && act(() => cancelInvoice(id))}>✕</button>
        </>
      )}
      {err && <span className="small text-bad">{err}</span>}
    </div>
  );
}

export function ResendLink({ id }: { id: string }) {
  const { t } = useT();
  const { pending, act } = useAct();
  const [done, setDone] = useState(false);
  return <button className="btn plain sm" style={{ paddingLeft: 0 }} disabled={pending || done} onClick={() => { act(() => resendInvoice(id)); setDone(true); }}><Icon name="msg" size="sm" />{done ? t("pay.resent") : t("pay.resend")}</button>;
}

export function ReceiptButton({ id, has }: { id: string; has: boolean }) {
  const { t } = useT();
  const { pending, act } = useAct();
  return (
    <label className="btn plain sm" style={{ cursor: "pointer" }}>
      <Icon name="clip" size="sm" />{has ? t("pay.receiptReplace") : t("pay.attachReceipt")}
      <input type="file" accept="image/*,application/pdf" hidden disabled={pending} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = await upload(f); act(() => attachReceipt(id, r.url)); }} />
    </label>
  );
}

export function PayDetails({ initial }: { initial: string }) {
  const { t } = useT();
  const { pending, act } = useAct();
  const [v, setV] = useState(initial);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn secondary sm" onClick={() => setOpen(true)}><Icon name="card" size="sm" />{t("pay.details")}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("pay.details")}>
        <p className="muted mt-0">{t("pay.detailsLead")}</p>
        <textarea className="textarea" value={v} onChange={(e) => setV(e.target.value)} placeholder={t("pay.detailsPh")} aria-label={t("pay.details")} />
        <div className="actions"><button className="btn secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending} onClick={() => { act(() => savePayDetails(v)); setOpen(false); }}>{t("common.save")}</button></div>
      </Dialog>
    </>
  );
}
