"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { addPayment, blockTeacher, createTeacher, deleteArticle, extendAccess, saveArticle, savePlan, setAdminNote, setTeacherPlan, teacherLink, type ArticleInput, type PlanInput } from "@/lib/admin/actions";
import { FEATURES } from "@/lib/admin/features";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";

type Res = { ok: true } | { ok: false; error: string };
/** Вызов действия с «занято», ошибкой и обновлением страницы. */
function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async <T extends Res>(fn: () => Promise<T>, then?: (r: T) => void) => {
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      if (!r.ok) setErr(r.error); else { then?.(r); router.refresh(); }
    } catch { setErr("fail"); }
    setBusy(false);
  };
  return { busy, err, run, setErr };
}

function CopyLink({ link }: { link: string }) {
  const { t } = useT();
  const [ok, setOk] = useState(false);
  return (
    <div className="admlink">
      <input className="input" readOnly value={link} aria-label={t("adm.link")} onFocus={(e) => e.target.select()} />
      <button type="button" className="btn secondary" onClick={() => { void navigator.clipboard?.writeText(link); setOk(true); }}><Icon name="copy" size="sm" />{ok ? t("adm.copied") : t("adm.copy")}</button>
    </div>
  );
}

// ───────── добавить учителя ─────────

export function AddTeacher({ plans }: { plans: { id: string; name: string }[] }) {
  const { t } = useT();
  const { busy, err, run } = useAct();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", lastName: "", email: "", days: 14, planId: "" });
  const [link, setLink] = useState<string | null>(null);
  const close = () => { setOpen(false); setLink(null); setF({ name: "", lastName: "", email: "", days: 14, planId: "" }); };
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}><Icon name="plus" size="sm" />{t("adm.addTeacher")}</button>
      {open && (
        <Dialog open onClose={close} title={t("adm.addTeacher")}>
          {link ? (
            <>
              <p className="alert ok mt-0">✓ {t("adm.added")}</p>
              <p className="small muted">{t("adm.linkHint")}</p>
              <CopyLink link={link} />
              <div className="actions"><button type="button" className="btn primary" onClick={close}>{t("common.close")}</button></div>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="field"><label htmlFor="at-n">{t("adm.f.name")}</label><input id="at-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></div>
                <div className="field"><label htmlFor="at-l">{t("adm.f.lastName")}</label><input id="at-l" className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></div>
              </div>
              <div className="field mt-3"><label htmlFor="at-e">{t("adm.email")}</label><input id="at-e" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              <div className="field mt-3">
                <span className="flabel">{t("adm.trialDays")}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {[7, 14, 30, 60].map((n) => <button key={n} type="button" className={`pchip ${f.days === n ? "on" : ""}`} aria-pressed={f.days === n} onClick={() => setF({ ...f, days: n })}>{t("adm.nDays", { n })}</button>)}
                  <input className="input" type="number" min={1} max={365} style={{ width: 90 }} value={f.days} aria-label={t("adm.trialDays")} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} />
                </div>
              </div>
              <div className="field mt-3"><label htmlFor="at-p">{t("adm.planAfter")}</label>
                <select id="at-p" className="select" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}><option value="">—</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </div>
              <p className="hint">{t("adm.addHint")}</p>
              {err && <div className="alert">{t(`adm.err.${err}` as "adm.err.fail")}</div>}
              <div className="actions"><button type="button" className="btn secondary" onClick={close}>{t("common.cancel")}</button>
                <button type="button" className="btn primary" disabled={busy || !f.name.trim() || !f.email.trim()} onClick={() => run(() => createTeacher({ ...f, planId: f.planId || null }), (r) => setLink((r as { link: string }).link))}>{t("adm.create")}</button></div>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

// ───────── управление учителем ─────────

export function TeacherAdmin({ id, name, planId, plans, blocked, note: note0 }: { id: string; name: string; planId: string | null; plans: { id: string; name: string; priceMonth: number; active: boolean }[]; blocked: boolean; note: string }) {
  const { t } = useT();
  const { busy, err, run } = useAct();
  const [until, setUntil] = useState("");
  const [note, setNote] = useState(note0);
  const [pay, setPay] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  return (
    <aside className="flex min-w-0 flex-col gap-0">
      <section className="card">
        <h2 className="mb-1">{t("adm.trial")}</h2>
        <p className="small muted mt-0">{t("adm.trialHint")}</p>
        <div className="flex flex-wrap gap-2">{[7, 14, 30].map((n) => <button key={n} type="button" className="btn secondary sm" disabled={busy} onClick={() => run(() => extendAccess(id, { kind: "trial", days: n }))}>+{t("adm.nDays", { n })}</button>)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="date" className="input" style={{ width: 170 }} value={until} onChange={(e) => setUntil(e.target.value)} aria-label={t("adm.untilDate")} />
          <button type="button" className="btn plain sm" disabled={busy || !until} onClick={() => run(() => extendAccess(id, { kind: "trial", until }))}>{t("adm.setDate")}</button>
        </div>
      </section>
      <section className="card">
        <h2 className="mb-3">{t("adm.c.plan")}</h2>
        <select className="select" value={planId ?? ""} disabled={busy} aria-label={t("adm.c.plan")} onChange={(e) => run(() => setTeacherPlan(id, e.target.value || null))}>
          <option value="">—</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : ` (${t("adm.archived")})`}</option>)}
        </select>
        <button type="button" className="btn primary mt-3 w-full" onClick={() => setPay(true)}><Icon name="coin" size="sm" />{t("adm.addPayment")}</button>
        <div className="mt-2 flex flex-wrap gap-2">{[1, 3].map((n) => <button key={n} type="button" className="btn plain sm" disabled={busy} onClick={() => run(() => extendAccess(id, { kind: "paid", days: 30 * n }))}>{t("adm.giftMonths", { n })}</button>)}</div>
      </section>
      <section className="card">
        <h2 className="mb-2">{t("adm.note")}</h2>
        <textarea className="textarea" rows={4} value={note} placeholder={t("adm.notePh")} aria-label={t("adm.note")} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="btn secondary sm mt-2" disabled={busy || note === note0} onClick={() => run(() => setAdminNote(id, note))}>{t("common.save")}</button>
      </section>
      <section className="card">
        <button type="button" className="btn secondary w-full" disabled={busy} onClick={() => run(() => teacherLink(id), (r) => setLink((r as { link: string }).link))}><Icon name="link" size="sm" />{t("adm.newLink")}</button>
        {link && <div className="mt-2"><CopyLink link={link} /></div>}
        <button type="button" className={`btn w-full mt-2 ${blocked ? "secondary" : "plain text-bad"}`} disabled={busy} onClick={() => (blocked || confirm(t("adm.blockQ", { n: name }))) && run(() => blockTeacher(id, !blocked))}>{blocked ? t("adm.unblock") : t("adm.block")}</button>
      </section>
      {err && <div className="alert">{t(`adm.err.${err}` as "adm.err.fail")}</div>}
      {pay && <PaymentDialog teachers={[{ id, name }]} plans={plans} planId={planId} onClose={() => setPay(false)} />}
    </aside>
  );
}

export function PaymentDialog({ teachers, plans, planId, onClose }: { teachers: { id: string; name: string }[]; plans: { id: string; name: string; priceMonth: number; active: boolean }[]; planId: string | null; onClose: () => void }) {
  const { t } = useT();
  const { busy, err, run } = useAct();
  const today = new Date().toISOString().slice(0, 10);
  const p0 = plans.find((p) => p.id === planId) ?? null;
  const [f, setF] = useState({ teacherId: teachers.length === 1 ? teachers[0].id : "", planId: p0?.id ?? "", months: 1, amount: p0?.priceMonth ?? 0, paidAt: today, note: "" });
  const setPlan = (id: string) => { const p = plans.find((x) => x.id === id); setF({ ...f, planId: id, amount: p ? p.priceMonth * f.months : f.amount }); };
  const setMonths = (m: number) => { const p = plans.find((x) => x.id === f.planId); setF({ ...f, months: m, amount: p ? p.priceMonth * m : f.amount }); };
  return (
    <Dialog open onClose={onClose} title={t("adm.addPayment")}>
      {teachers.length > 1 && (
        <div className="field mb-3"><label htmlFor="pd-t">{t("adm.c.teacher")}</label>
          <select id="pd-t" className="select" value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: e.target.value })}><option value="">—</option>{teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field"><label htmlFor="pd-p">{t("adm.c.plan")}</label>
          <select id="pd-p" className="select" value={f.planId} onChange={(e) => setPlan(e.target.value)}><option value="">—</option>{plans.filter((p) => p.active || p.id === f.planId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="field"><label htmlFor="pd-m">{t("adm.c.months")}</label>
          <select id="pd-m" className="select" value={f.months} onChange={(e) => setMonths(Number(e.target.value))}>{[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
        <div className="field"><label htmlFor="pd-a">{t("adm.c.amount")}</label><input id="pd-a" className="input" type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="pd-d">{t("adm.c.date")}</label><input id="pd-d" className="input" type="date" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></div>
      </div>
      <div className="field mt-3"><label htmlFor="pd-n">{t("adm.c.note")}</label><input id="pd-n" className="input" value={f.note} placeholder={t("adm.payNotePh")} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      <p className="hint">{t("adm.payHint")}</p>
      {err && <div className="alert">{t(`adm.err.${err}` as "adm.err.fail")}</div>}
      <div className="actions"><button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn primary" disabled={busy || !f.teacherId || !(f.amount > 0)} onClick={() => run(() => addPayment({ ...f, planId: f.planId || null }), onClose)}>{t("common.save")}</button></div>
    </Dialog>
  );
}

export function AddPaymentButton({ teachers, plans }: { teachers: { id: string; name: string }[]; plans: { id: string; name: string; priceMonth: number; active: boolean }[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}><Icon name="plus" size="sm" />{t("adm.addPayment")}</button>
      {open && <PaymentDialog teachers={teachers} plans={plans} planId={null} onClose={() => setOpen(false)} />}
    </>
  );
}

// ───────── тарифы ─────────

export type PlanView = PlanInput & { id: string; teachers: number };

export function PlanEdit({ plan }: { plan: PlanView | null }) {
  const { t, lang } = useT();
  const { busy, err, run } = useAct();
  const [open, setOpen] = useState(false);
  const blank: PlanInput = { id: null, name: "", nameEn: "", tier: "PRO", priceMonth: 0, priceYear: null, maxStudents: null, aiPerMonth: null, features: FEATURES.filter((x) => x.group === "core").map((x) => x.key), blurb: "", active: true };
  const [f, setF] = useState<PlanInput>(plan ?? blank);
  const num = (v: string) => (v === "" ? null : Number(v));
  const L = lang === "en" ? "en" : "ru";
  return (
    <>
      {plan ? <button type="button" className="btn secondary sm" onClick={() => setOpen(true)}><Icon name="pencil" size="sm" />{t("common.edit")}</button>
        : <button type="button" className="btn primary" onClick={() => { setF(blank); setOpen(true); }}><Icon name="plus" size="sm" />{t("adm.addPlan")}</button>}
      {open && (
        <Dialog open onClose={() => setOpen(false)} title={plan ? plan.name : t("adm.addPlan")} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field"><label htmlFor="pl-n">{t("adm.f.name")}</label><input id="pl-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="pl-ne">{t("adm.f.nameEn")}</label><input id="pl-ne" className="input" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></div>
            <div className="field"><label htmlFor="pl-pm">{t("adm.f.priceMonth")}</label><input id="pl-pm" className="input" type="number" min={0} value={f.priceMonth} onChange={(e) => setF({ ...f, priceMonth: Number(e.target.value) })} /></div>
            <div className="field"><label htmlFor="pl-py">{t("adm.f.priceYear")}</label><input id="pl-py" className="input" type="number" min={0} value={f.priceYear ?? ""} placeholder="—" onChange={(e) => setF({ ...f, priceYear: num(e.target.value) })} /></div>
            <div className="field"><label htmlFor="pl-ms">{t("adm.f.maxStudents")}</label><input id="pl-ms" className="input" type="number" min={0} value={f.maxStudents ?? ""} placeholder={t("adm.unlimited")} onChange={(e) => setF({ ...f, maxStudents: num(e.target.value) })} /></div>
            <div className="field"><label htmlFor="pl-ai">{t("adm.f.ai")}</label><input id="pl-ai" className="input" type="number" min={0} value={f.aiPerMonth ?? ""} placeholder={t("adm.unlimited")} onChange={(e) => setF({ ...f, aiPerMonth: num(e.target.value) })} /></div>
          </div>
          <div className="field mt-3"><label htmlFor="pl-b">{t("adm.f.blurb")}</label><input id="pl-b" className="input" value={f.blurb} onChange={(e) => setF({ ...f, blurb: e.target.value })} /></div>
          <div className="field mt-3">
            <span className="flabel">{t("adm.f.features")}</span>
            <div className="admfeat">
              {FEATURES.map((x) => (
                <label key={x.key} className="admfeat-i"><input type="checkbox" checked={f.features.includes(x.key)} onChange={(e) => setF({ ...f, features: e.target.checked ? [...f.features, x.key] : f.features.filter((k) => k !== x.key) })} /><span>{x[L]}</span></label>
              ))}
            </div>
          </div>
          <label className="setting mt-2"><span>{t("adm.f.active")}<br /><span className="small muted">{t("adm.f.activeHint")}</span></span><span className="switch"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span /></span></label>
          {err && <div className="alert">{t(`adm.err.${err}` as "adm.err.fail")}</div>}
          <div className="actions"><button type="button" className="btn secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button type="button" className="btn primary" disabled={busy || !f.name.trim()} onClick={() => run(() => savePlan({ ...f, tier: f.features.some((k) => k.startsWith("ai_")) ? "PRO" : "START" }), () => setOpen(false))}>{t("common.save")}</button></div>
        </Dialog>
      )}
    </>
  );
}

// ───────── база знаний ─────────

export function ArticleEdit({ a }: { a: (ArticleInput & { id: string }) | null }) {
  const { t } = useT();
  const { busy, err, run } = useAct();
  const [open, setOpen] = useState(false);
  const blank: ArticleInput = { id: null, title: "", body: "", kind: "guide", audience: "teacher", published: false, pinned: false };
  const [f, setF] = useState<ArticleInput>(a ?? blank);
  return (
    <>
      {a ? <button type="button" className="btn secondary sm" onClick={() => { setF(a); setOpen(true); }}><Icon name="pencil" size="sm" />{t("common.edit")}</button>
        : <button type="button" className="btn primary" onClick={() => { setF(blank); setOpen(true); }}><Icon name="plus" size="sm" />{t("adm.addArticle")}</button>}
      {open && (
        <Dialog open onClose={() => setOpen(false)} title={a ? t("adm.editArticle") : t("adm.addArticle")} wide>
          <div className="field"><label htmlFor="ar-t">{t("adm.f.title")}</label><input id="ar-t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></div>
          <div className="mt-3 flex flex-wrap gap-4">
            <div className="field"><span className="flabel">{t("adm.f.kind")}</span>
              <div className="seg">{(["guide", "digest", "news"] as const).map((k) => <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{t(`adm.kind.${k}`)}</button>)}</div></div>
            <div className="field"><span className="flabel">{t("adm.f.audience")}</span>
              <div className="seg">{(["teacher", "student", "all"] as const).map((k) => <button key={k} type="button" aria-pressed={f.audience === k} onClick={() => setF({ ...f, audience: k })}>{t(`adm.aud.${k}`)}</button>)}</div></div>
          </div>
          <div className="field mt-3"><label htmlFor="ar-b">{t("adm.f.body")}</label><textarea id="ar-b" className="textarea" rows={12} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /><span className="hint">{t("adm.bodyHint")}</span></div>
          <label className="setting"><span>{t("adm.f.published")}</span><span className="switch"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /><span /></span></label>
          <label className="setting"><span>{t("adm.f.pinned")}</span><span className="switch"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /><span /></span></label>
          {err && <div className="alert">{t(`adm.err.${err}` as "adm.err.fail")}</div>}
          <div className="actions">
            {a && <button type="button" className="btn plain text-bad" style={{ marginRight: "auto" }} disabled={busy} onClick={() => confirm(t("adm.delArticleQ")) && run(() => deleteArticle(a.id), () => setOpen(false))}>{t("common.delete")}</button>}
            <button type="button" className="btn secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button type="button" className="btn primary" disabled={busy || !f.title.trim()} onClick={() => run(() => saveArticle(f), () => setOpen(false))}>{t("common.save")}</button></div>
        </Dialog>
      )}
    </>
  );
}
