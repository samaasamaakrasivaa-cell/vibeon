"use client";
import { LinkMaker } from "./InviteForm";
import { addFeedback } from "@/lib/teacher/actions";
import { payerLinkAction } from "@/lib/billing/actions";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { PackTicket } from "./PackTicket";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { TIMEZONES } from "@/lib/time";
import { billNow, requestPackPayment } from "@/lib/billing/actions";
import {
  addPack, archiveStudent, packReturn, requestTgConnect, deleteStudent, savePayment, savePrivateNote, updateStudentProfile, type Result,
} from "@/lib/teacher/actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn().catch(() => ({ ok: false as const, error: "Error" }));
      if (!r.ok) return setError(r.error);
      // Обновление страницы — после завершения действия, вне этой операции (внутри неё два обновления
      // иногда блокировали друг друга). Само действие тоже обновляет страницу через revalidatePath.
      setTimeout(() => router.refresh(), 0);
      after?.();
    });
  return { pending, error, run };
}

export type ProfileData = {
  id: string; name: string; lastName: string; email: string; phone: string; telegram: string; timezone: string; callLink: string;
  course: string; level: string; interests: string; examGoal: string; source: string; birthday: string; startedAt: string; archived: boolean;
};

export function ProfileActions({ p }: { p: ProfileData }) {
  const { t } = useT();
  const [edit, setEdit] = useState(false);
  const { pending, error, run } = useRun();
  const [f, setF] = useState(p);
  const field = (k: keyof ProfileData, label: string, type = "text") => (
    <div className="field">
      <label htmlFor={`pf-${k}`}>{label}</label>
      <input id={`pf-${k}`} type={type} className="input" value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );
  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn secondary sm" onClick={() => { setF(p); setEdit(true); }}><Icon name="pencil" size="sm" />{t("prof.edit")}</button>
      <button className="btn secondary sm" disabled={pending} onClick={() => run(() => archiveStudent(p.id, !p.archived))}>
        <Icon name="archive" size="sm" />{p.archived ? t("prof.restore") : t("prof.toArchive")}
      </button>
      <Dialog open={edit} onClose={() => setEdit(false)} title={t("prof.edit")} wide>
        <div className="grid-2">
          {field("name", t("ob.first"))}
          {field("lastName", t("ob.last"))}
          {field("email", t("auth.email"), "email")}
          {field("phone", t("ob.phone"), "tel")}
          {field("telegram", "Telegram")}
          <div className="field">
            <label htmlFor="pf-tz">{t("prof.tz")}</label>
            <select id="pf-tz" className="select" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">{field("callLink", t("prof.callLink"), "url")}</div>
        <div className="grid-2 mt-3">
          {field("course", t("prof.course"))}
          {field("level", t("prof.level"))}
          {field("interests", t("prof.interests"))}
          {field("examGoal", t("prof.examGoal"))}
          {field("birthday", t("prof.birthday"), "date")}
          {field("startedAt", t("prof.started"), "date")}
          {field("source", t("prof.source"))}
        </div>
        {error && <div className="alert mt-3">{error}</div>}
        <div className="actions">
          <button className="btn secondary" onClick={() => setEdit(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending} onClick={() => run(() => { const { archived: _a, ...rest } = f; void _a; return updateStudentProfile(p.id, rest); }, () => setEdit(false))}>{t("common.save")}</button>
        </div>
      </Dialog>
    </div>
  );
}

/** Личные заметки учителя: сохраняются сами через секунду после ввода. */
export function PrivateNote({ id, initial }: { id: string; initial: string }) {
  const { t } = useT();
  const [v, setV] = useState(initial);
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <section className="card sm notecard">
      <div className="flex items-center justify-between">
        <p className="cardtitle">{t("prof.privateNote")}</p>
        <span className="small text-text3">{state === "saving" ? t("common.saving") : state === "saved" ? `✓ ${t("common.saved")}` : ""}</span>
      </div>
      <textarea
        className="textarea"
        value={v}
        placeholder={t("prof.privatePh")}
        onChange={(e) => {
          setV(e.target.value);
          setState("saving");
          if (timer.current) clearTimeout(timer.current);
          const val = e.target.value;
          timer.current = setTimeout(() => savePrivateNote(id, val).then(() => setState("saved")), 900);
        }}
      />
    </section>
  );
}

export type PaymentData = {
  id: string; payType: "PACK" | "POSTPAID"; billRule: string; remindEveryDays: number | null; price: number | null;
  packPrices: { n: number; price: number; main?: boolean }[]; payerName: string; payerContact: string;
  pack: { left: number; total: number; price: number; since?: string; ends?: string | null; frozen?: string | null; used?: { id: string; date: string; missed: boolean }[] } | null;
  today?: string;
  payerLinked?: boolean; studentName?: string; teacherName?: string;
};

const PACK_RULES = ["pack_left_1", "pack_left_2", "pack_end"];
const POST_RULES = ["after_5", "after_15", "after_30", "after_60", "next_day", "every_4_weeks"];

/** «Мама — Ирина» → «Ирина»: для обращения в сообщении. */
const payerFirst = (s: string) => (s.split(/\s[—–-]\s/).pop() ?? s).trim();

export function PaymentCard({ p, earnedMonth }: { p: PaymentData; earnedMonth: string }) {
  const { t } = useT();
  const { pending, error, run } = useRun();
  const [payType, setPayType] = useState(p.payType);
  const [rule, setRule] = useState(p.billRule || (p.payType === "PACK" ? "pack_left_1" : "after_15"));
  const [remind, setRemind] = useState<number | null>(p.remindEveryDays ?? 3);
  const [price, setPrice] = useState(p.price ? String(p.price) : "");
  // 4 / 8 / 12 и любые другие размеры, которые уже есть у ученика (например, 10) — чтобы не потерять их при сохранении
  const [packs, setPacks] = useState(() => [...new Set([4, 8, 12, ...p.packPrices.map((x) => x.n)])].sort((a, b) => a - b).map((n) => ({ n, price: p.packPrices.find((x) => x.n === n)?.price ?? 0 })));
  // основной абонемент: по нему выставляется счёт за новый абонемент
  const [mainN, setMainN] = useState<number>(() => p.packPrices.find((x) => x.main)?.n ?? (p.pack && p.packPrices.some((x) => x.n === p.pack!.total) ? p.pack.total : p.packPrices.find((x) => x.n === 8 && x.price > 0)?.n ?? p.packPrices.find((x) => x.price > 0)?.n ?? 8));
  const [payerOn, setPayerOn] = useState(!!(p.payerName || p.payerContact));
  const [payerName, setPayerName] = useState(p.payerName);
  const [payerContact, setPayerContact] = useState(p.payerContact);
  const [saved, setSaved] = useState(false);
  const [newPack, setNewPack] = useState(false);
  const [np, setNp] = useState({ n: 8, price: 0, start: "", other: false });
  // «Вручную» больше не предлагаем; у тех, у кого оно уже стоит, — оставляем видимым
  const rules = payType === "PACK" ? PACK_RULES : rule === "manual" ? [...POST_RULES, "manual"] : POST_RULES;

  const payload = (pt: "PACK" | "POSTPAID", r: string) => ({ payType: pt, billRule: r, remindEveryDays: remind, price: Number(price) || null, packPrices: packs.map((x) => ({ ...x, price: x.price || (x.n === mainN ? (Number(price) || 0) * x.n : 0), main: x.n === mainN })).filter((x) => x.price > 0), payerOn, payerName, payerContact });
  const save = () => run(() => savePayment(p.id, payload(payType, rule)), () => setSaved(true));
  // тип оплаты переключается сразу, без кнопки «Сохранить»
  const switchType = (pt: "PACK" | "POSTPAID") => {
    if (pt === payType) return;
    const r = pt === "PACK" ? "pack_left_1" : "after_15";
    setPayType(pt); setRule(r);
    run(() => savePayment(p.id, payload(pt, r)));
  };
  const packPrice = (n: number) => packs.find((x) => x.n === n)?.price || (Number(price) || 0) * n;
  const openNew = () => { setNp({ n: mainN, price: packPrice(mainN), start: p.today ?? "", other: ![4, 8, 12].includes(mainN) }); setNewPack(true); };
  const used = p.pack?.used ?? [];

  return (
    <section className="card sm paybox">
      <div className="paybox-head">
        <p className="cardtitle m-0">{t("prof.payment")}</p>
        <div className="seg" role="group" aria-label={t("prof.payType")}>
          <button type="button" aria-pressed={payType === "PACK"} disabled={pending} onClick={() => switchType("PACK")}>{t("prof.pack")}</button>
          <button type="button" aria-pressed={payType === "POSTPAID"} disabled={pending} onClick={() => switchType("POSTPAID")}>{t("prof.postpaid")}</button>
        </div>
      </div>

      {payType === "PACK" && (p.pack ? (
        <>
          <PackTicket studentId={p.id} today={p.today ?? ""} pack={{ left: p.pack.left, total: p.pack.total, since: p.pack.since, ends: p.pack.ends ?? null, frozen: p.pack.frozen ?? null }} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={`btn ${p.pack.left <= 1 ? "primary" : "secondary"} sm`} onClick={openNew}><Icon name="plus" size="sm" />{t("prof.newPack")}</button>
            <button className="btn plain sm" disabled={pending} onClick={() => run(() => requestPackPayment(p.id))}><Icon name="msg" size="sm" />{t("prof.requestPay")}</button>
          </div>
          <details className="paymore">
            <summary><span>{t("pay.deductHistory")}</span><span className="small muted">{used.length}</span><Icon name="chevd" size="sm" /></summary>
            <div className="packused">
              {used.length === 0 ? <p className="hint m-0">{t("prof.packNoUsed")}</p> : used.map((u) => (
                <div key={u.id} className="lprice">
                  <span className="grow">{u.date}{u.missed ? ` · ${t("sch.st.missed")}` : ""}</span>
                  <button type="button" className="btn plain sm" disabled={pending} onClick={() => confirm(t("prof.packReturnQ", { d: u.date })) && run(() => packReturn(u.id))}>{t("prof.packReturn")}</button>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : (
        <div className="payempty">
          <p className="m-0 small muted">{t("prof.noPack")}</p>
          <button className="btn primary w-full" onClick={openNew}><Icon name="plus" size="sm" />{t("prof.newPack")}</button>
          <button className="btn plain sm" disabled={pending} onClick={() => run(() => requestPackPayment(p.id))}><Icon name="msg" size="sm" />{t("prof.requestPay")}</button>
        </div>
      ))}
      {payType === "POSTPAID" && (
        <div className="payempty">
          <p className="m-0"><b>{price ? t("pay.lessonPriceShort", { p: `${Number(price).toLocaleString("ru-RU")} ₽` }) : t("prof.lessonPrice")}</b></p>
          <button className="btn primary w-full" disabled={pending} onClick={() => run(() => billNow(p.id))}><Icon name="msg" size="sm" />{t("pay.billNow")}</button>
          <span className="small muted">{t("pay.billNowHint")}</span>
        </div>
      )}
      {error && !newPack && <div className="alert mt-3">{error}</div>}

      <details className="paymore" onChange={() => setSaved(false)}>
        <summary><span>{t("pay.settings")}</span><Icon name="chevd" size="sm" /></summary>
        <p className="small muted mt-0">{t("pay.settingsSub")}</p>
        <div className="flex flex-col gap-3">
          <div className="field">
            <label htmlFor="pr-price">{t("prof.lessonPrice")}</label>
            <input id="pr-price" className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder="3000" />
          </div>
          {payType === "PACK" && (
            <div className="field">
              <span className="flabel">{t("prof.packPrices")}</span>
              {packs.map((x, i) => (
                <div key={x.n} className="grid grid-cols-[110px_1fr_auto] items-center gap-2">
                  <label className="flex items-center gap-2 small"><input type="radio" name={`main-${p.id}`} checked={mainN === x.n} onChange={() => { setMainN(x.n); setSaved(false); }} aria-label={`${t("prof.mainPack")}: ${x.n}`} />{x.n} {t("prof.lessons")}</label>
                  <input className="input" inputMode="numeric" value={x.price || ""} placeholder={price ? String(Number(price) * x.n) : "—"}
                    onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, "")) || 0; setPacks(packs.map((y, j) => (j === i ? { ...y, price: v } : y))); }} aria-label={`${x.n}`} />
                  <span className="small text-text3 min-w-[90px]">{x.price ? `${Math.round(x.price / x.n)} ₽ / ${t("prof.lessonShort")}` : ""}</span>
                </div>
              ))}
              <span className="hint">{t("prof.mainPackHint", { n: mainN })} {t("prof.packHint")}</span>
            </div>
          )}
          <div className="field">
            <label htmlFor="pr-rule">{t("prof.whenBill")}</label>
            <select id="pr-rule" className="select" value={rule} onChange={(e) => setRule(e.target.value)}>
              {rules.map((r) => <option key={r} value={r}>{t(`bill.${r}` as never)}</option>)}
            </select>
          </div>
          <div className="setting">
            <span className="muted">{t("prof.remind")}</span>
            <select className="select" style={{ width: "auto" }} value={remind ?? 0} onChange={(e) => setRemind(Number(e.target.value) || null)} aria-label={t("prof.remind")}>
              <option value={1}>{t("prof.every1")}</option>
              <option value={3}>{t("prof.every3")}</option>
              <option value={7}>{t("prof.every7")}</option>
              <option value={0}>{t("prof.never")}</option>
            </select>
          </div>
          <label className="setting">
            <span className="muted">{t("prof.payer")}</span>
            <span className="switch"><input type="checkbox" checked={payerOn} onChange={(e) => setPayerOn(e.target.checked)} /><span /></span>
          </label>
          {payerOn && (
            <div className="grid-2">
              <div className="field"><label htmlFor="py-n">{t("prof.payerName")}</label><input id="py-n" className="input" value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder={t("prof.payerNamePh")} /></div>
              <div className="field"><label htmlFor="py-c">{t("prof.payerContact")}</label><input id="py-c" className="input" value={payerContact} onChange={(e) => setPayerContact(e.target.value)} placeholder="@mama / +7 900 …" /></div>
            </div>
          )}
          {payerOn && (p.payerLinked ? (
            <p className="small text-ok m-0">✓ {t("payer.linked")}</p>
          ) : p.payerName ? (
            <div className="payerbox">
              <LinkMaker label={t("payer.make")} hint={t("payer.hint")} icon="send" make={payerLinkAction.bind(null, p.id)} kind="payer" vars={{ name: payerFirst(p.payerName), teacher: p.teacherName }} />
            </div>
          ) : <p className="hint m-0">{t("payer.saveFirst")}</p>)}
          <div className="flex items-center gap-3">
            <button className="btn primary sm" disabled={pending} onClick={save}>{t("common.save")}</button>
            {saved && <span className="small text-ok">✓ {t("common.saved")}</span>}
          </div>
        </div>
      </details>
      <div className="paymonth small muted">{t("prof.thisMonth")} <b>{earnedMonth}</b> {t("prof.earnedWord")}</div>

      <Dialog open={newPack} onClose={() => setNewPack(false)} title={t("prof.newPack")}>
        <span className="flabel">{t("pay.newPackLessons")}</span>
        <div className="chips" role="radiogroup" aria-label={t("pay.newPackLessons")}>
          {[4, 8, 12].map((n) => (
            <label key={n} className="chip"><input type="radio" name="np-n" checked={!np.other && np.n === n} onChange={() => setNp({ ...np, n, price: packPrice(n), other: false })} /><span>{n} {n === 4 ? t("pay.lessons4") : t("prof.lessons")}</span></label>
          ))}
          <label className="chip"><input type="radio" name="np-n" checked={np.other} onChange={() => setNp({ ...np, other: true })} /><span>{t("pay.other")}</span></label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {np.other && <div className="field"><label htmlFor="np-n">{t("prof.packLessons")}</label><input id="np-n" className="input" inputMode="numeric" value={np.n || ""} onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")) || 0; setNp({ ...np, n, price: packPrice(n) }); }} /></div>}
          <div className="field"><label htmlFor="np-p">{t("prof.packPrice")}</label><input id="np-p" className="input" inputMode="numeric" value={np.price || ""} onChange={(e) => setNp({ ...np, price: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
          <div className="field"><label htmlFor="np-s">{t("pay.newPackStart")}</label><input id="np-s" type="date" className="input" value={np.start} onChange={(e) => setNp({ ...np, start: e.target.value })} /></div>
        </div>
        <p className="hint mt-3 mb-0">{np.n > 0 && np.price > 0 ? `${Math.round(np.price / np.n).toLocaleString("ru-RU")} ₽ / ${t("prof.lessonShort")} · ` : ""}{t("pay.newPackPriceHint")} {t("prof.newPackHint")}</p>
        {error && <div className="alert mt-3">{error}</div>}
        <div className="actions">
          <button className="btn secondary" onClick={() => setNewPack(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending || !(np.n > 0)} onClick={() => run(() => addPack(p.id, np.n, np.price, np.start || undefined), () => setNewPack(false))}>{t("prof.addPack")}</button>
        </div>
      </Dialog>
    </section>
  );
}

export function DeleteStudent({ id, name }: { id: string; name: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn plain" style={{ color: "var(--bad)" }} onClick={() => setOpen(true)}>{t("prof.delete")}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("prof.deleteQ")}>
        <p className="muted mt-0">{t("prof.deleteHint")}</p>
        <div className="field"><label htmlFor="dl">{t("prof.deleteType", { name })}</label><input id="dl" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></div>
        <div className="actions">
          <button className="btn secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
          <button className="btn danger" disabled={pending || typed.trim() !== name} onClick={() => start(() => deleteStudent(id))}>{t("common.delete")}</button>
        </div>
      </Dialog>
    </>
  );
}

/** «Отправить фидбэк» из анкеты: сохраняется в историю, ученик видит его в «Прогрессе». */
export function FeedbackForm({ studentId }: { studentId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <section className="card sm mb-4">
      <p className="cardtitle">{t("fb.new")}</p>
      <textarea className="textarea" rows={3} value={text} onChange={(e) => { setText(e.target.value); setDone(false); }} placeholder={t("fb.ph")} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn primary sm" disabled={pending || !text.trim()} onClick={() => start(async () => { const r = await addFeedback(studentId, text); if (r.ok) { setText(""); setDone(true); router.refresh(); } })}>
          <Icon name="send" size="sm" />{t("fb.send")}
        </button>
        {done ? <span className="small text-ok">✓ {t("fb.sent")}</span> : <span className="hint">{t("fb.hint")}</span>}
      </div>
    </section>
  );
}

/** Значок «бот не подключён» в анкете: нажать — попросить ученика подключить Telegram-бот. */
export function TgAsk({ id }: { id: string }) {
  const { t } = useT();
  const { pending, error, run } = useRun();
  const [sent, setSent] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" className="pill grey" title={t("prof.tgAskHint")} disabled={pending || sent} onClick={() => run(() => requestTgConnect(id), () => setSent(true))}>
        <Icon name="telegram" size="sm" />{t("prof.tgOff")} · {sent ? t("prof.tgAsked") : t("prof.tgAsk")}
      </button>
      {error && <span className="small text-bad">{error}</span>}
    </span>
  );
}
