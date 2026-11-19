"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon";
import { Dialog } from "../Dialog";
import { upload } from "../courses/CourseView";
import { useT } from "@/lib/i18n/client";
import { attachReceipt, cancelInvoice, closeInvoice, confirmLessonPaid, invoiceDetails, markPaid, updateInvoice, rejectProof, resendInvoice, savePayDetails, undoAuto } from "@/lib/billing/actions";

type Res = { ok: boolean; error?: string };
function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const act = (fn: () => Promise<Res>) => start(async () => { setErr(null); const r = await fn(); if (!r.ok) setErr(r.error ?? "Error"); setTimeout(() => router.refresh(), 0); });
  return { pending, err, act };
}

/** Исправить счёт: цены уроков в нём (сумма считается сама) или сумму целиком — и у оплаченного. */
export function InvoiceEdit({ id }: { id: string }) {
  const { t, lang } = useT();
  const { pending, err, act } = useAct();
  const [d, setD] = useState<Awaited<ReturnType<typeof invoiceDetails>> | null>(null);
  const [amount, setAmount] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const open = async () => {
    const x = await invoiceDetails(id);
    setD(x); setAmount(String(x.amount)); setPrices(Object.fromEntries(x.lessons.map((l) => [l.id, String(l.price)])));
  };
  const sum = d?.lessons.length ? d.lessons.reduce((a, l) => a + (Number(prices[l.id]) || 0), 0) : Number(amount) || 0;
  const fmt = (n: number) => new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB").format(n) + " ₽";
  const day = (iso: string) => new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short", weekday: "short" });
  return (
    <>
      <button type="button" className="iconbtn" title={t("pay.editInvoice")} aria-label={t("pay.editInvoice")} onClick={open}><Icon name="pencil" size="sm" /></button>
      {d && (
        <Dialog open onClose={() => setD(null)} title={t("pay.editInvoice")}>
          <p className="small muted mt-0">{d.title}{d.status === "PAID" ? ` · ${t("inv.PAID")}` : ""}</p>
          {d.lessons.length ? (
            <div className="lprices">
              {d.lessons.map((l) => (
                <label key={l.id} className="lprice">
                  <span className="grow">{day(l.at)}</span>
                  <input className="input" style={{ width: 110 }} inputMode="numeric" value={prices[l.id] ?? ""} aria-label={day(l.at)} onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value.replace(/\D/g, "").slice(0, 7) })} /> ₽
                </label>
              ))}
              <div className="flex justify-between px-2.5"><b>{t("pay.total")}</b><b>{fmt(sum)}</b></div>
            </div>
          ) : (
            <label className="field"><span className="flabel">{t("pay.amount")}</span><input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 8))} /></label>
          )}
          {d.status === "PAID" && <p className="hint">{t("pay.editPaidHint")}</p>}
          {err && <div className="alert mt-2">{err}</div>}
          <div className="actions">
            <button className="btn secondary" onClick={() => setD(null)}>{t("common.cancel")}</button>
            <button className="btn primary" disabled={pending || sum <= 0} onClick={() => act(async () => { const r = await updateInvoice(id, d.lessons.length ? { lessons: d.lessons.map((l) => ({ id: l.id, price: Number(prices[l.id]) || 0 })) } : { amount: Number(amount) }); if (r.ok) setD(null); return r; })}>{t("common.save")}</button>
          </div>
        </Dialog>
      )}
    </>
  );
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

/** «Оплачено» у проведённого урока без счёта. */
export function LessonPaidBtn({ id }: { id: string }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn primary sm" disabled={pending} onClick={() => start(async () => { const r = await confirmLessonPaid(id); setErr(r.ok ? null : r.error); })}><Icon name="check" size="sm" />{t("lp.confirm")}</button>
      {err && <span className="small text-bad">{err}</span>}
    </>
  );
}
