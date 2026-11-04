"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { upload } from "../courses/CourseView";
import { useT } from "@/lib/i18n/client";
import { buyPack, iPaid, payMessage } from "@/lib/billing/actions";

export function PaidButton({ id, amount }: { id: string; amount: string }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [fname, setFname] = useState("");
  const [res, setRes] = useState<null | "auto" | "sent">(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn light lg" onClick={() => { setOpen(true); setRes(null); }}>{t("pay.iPaid")}</button>
      <Dialog open={open} onClose={() => { setOpen(false); if (res) router.refresh(); }} title={t("pay.iPaid")}>
        {res ? <p className={`alert ${res === "auto" ? "ok" : ""}`} style={res === "sent" ? { background: "var(--accent-bg)", color: "var(--accent-text)" } : undefined}>{res === "auto" ? `✓ ${t("pay.autoOk", { amount })}` : t("pay.sentToCheck")}</p> : (
          <div className="flex flex-col gap-3">
            <p className="muted m-0">{t("pay.proofLead")}</p>
            <label className="upl">
              <Icon name="image" />{fname || t("pay.attachScreenshot")}
              <input type="file" accept="image/*,application/pdf" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setFname(f.name); try { setFile((await upload(f)).url); } catch { setErr(t("bld.uploadErr")); } }} />
            </label>
            <div className="field"><label htmlFor="pt">{t("pay.orText")}</label><textarea id="pt" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("pay.textPh", { amount })} /></div>
            {err && <div className="alert">{err}</div>}
            <div className="actions"><button className="btn secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
              <button className="btn primary" disabled={pending || (!text.trim() && !file)} onClick={() => start(async () => { const r = await iPaid(id, { text, file: file ?? undefined }); if (!r.ok) setErr(r.error); else setRes(r.auto ? "auto" : "sent"); })}>{t("cls.send")}</button></div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/** Готовое сообщение преподавателю («Мне нужен чек», «Заморозить»). */
export function MessageButton({ label, text, className = "btn glass lg", icon }: { label: string; text: string; className?: string; icon?: Parameters<typeof Icon>[0]["name"] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(text);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <button className={className} onClick={() => { setOpen(true); setSent(false); setV(text); }}>{icon && <Icon name={icon} size="sm" />}{label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label}>
        {sent ? <p className="alert ok">✓ {t("sts.reqSent")}</p> : (
          <>
            <p className="muted mt-0">{t("sts.reqLead")}</p>
            <textarea className="textarea" value={v} onChange={(e) => setV(e.target.value)} aria-label={label} />
            <div className="actions"><button className="btn secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
              <button className="btn primary" disabled={pending || !v.trim()} onClick={() => start(async () => { const r = await payMessage(v); if (r.ok) setSent(true); })}>{t("cls.send")}</button></div>
          </>
        )}
      </Dialog>
    </>
  );
}

export function BuyPack({ n, label, className = "btn primary sm" }: { n: number; label: string; className?: string }) {
  const { t } = useT();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col gap-1">
      <button className={className} disabled={pending} onClick={() => start(async () => { const r = await buyPack(n); if (!r.ok) setErr(r.error); else router.push("/student/payments?tab=bills"); })}>{label}</button>
      {err && <span className="small text-bad">{err}</span>}
      {pending && <span className="small muted">{t("common.saving")}</span>}
    </span>
  );
}
