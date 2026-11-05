"use client";
import { LinkMaker } from "./InviteForm";
import { addFeedback } from "@/lib/teacher/actions";
import { payerLinkAction } from "@/lib/billing/actions";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { TIMEZONES } from "@/lib/time";
import { billNow, requestPackPayment } from "@/lib/billing/actions";
import {
  addPack, archiveStudent, deleteStudent, savePayment, savePrivateNote, updateStudentProfile, type Result,
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
  pack: { left: number; total: number; price: number } | null;
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
  const [np, setNp] = useState({ n: 8, price: 0 });
  // «Вручную» больше не предлагаем; у тех, у кого оно уже стоит, — оставляем видимым
  const rules = payType === "PACK" ? PACK_RULES : rule === "manual" ? [...POST_RULES, "manual"] : POST_RULES;

  const save = () =>
    run(() => savePayment(p.id, { payType, billRule: rule, remindEveryDays: remind, price: Number(price) || null, packPrices: packs.map((x) => ({ ...x, price: x.price || (x.n === mainN ? (Number(price) || 0) * x.n : 0), main: x.n === mainN })).filter((x) => x.price > 0), payerOn, payerName, payerContact }), () => setSaved(true));

  const circ = 2 * Math.PI * 46;
  return (
    <section className="card sm" onChange={() => setSaved(false)}>
      <p className="cardtitle">{t("prof.payment")}</p>
      <div className="flex flex-col gap-3">
        <div className="setting">
          <span className="muted">{t("prof.payType")}</span>
          <div className="seg">
            <button type="button" aria-pressed={payType === "PACK"} onClick={() => { setPayType("PACK"); setRule("pack_left_1"); setSaved(false); }}>{t("prof.pack")}</button>
            <button type="button" aria-pressed={payType === "POSTPAID"} onClick={() => { setPayType("POSTPAID"); setRule("after_15"); setSaved(false); }}>{t("prof.postpaid")}</button>
          </div>
        </div>
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
        {error && <div className="alert">{error}</div>}
        <div className="flex items-center gap-3">
          <button className="btn primary sm" disabled={pending} onClick={save}>{t("common.save")}</button>
          {saved && <span className="small text-ok">✓ {t("common.saved")}</span>}
        </div>
      </div>

      {payType === "PACK" && (
        <div className="mt-5 border-t border-sep pt-5">
          {p.pack ? (
            <div className="flex items-center gap-5">
              <svg className="pring" viewBox="0 0 110 110" aria-hidden="true">
                <circle cx="55" cy="55" r="46" fill="none" stroke="var(--fill)" strokeWidth="10" />
                <circle cx="55" cy="55" r="46" fill="none" stroke="var(--ok)" strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${(circ * p.pack.left) / Math.max(1, p.pack.total)} ${circ}`} transform="rotate(-90 55 55)" />
                <text x="55" y="58" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--text)">{p.pack.left}</text>
                <text x="55" y="76" textAnchor="middle" fontSize="11" fill="var(--text2)">{t("prof.leftShort")}</text>
              </svg>
              <div><b className="text-[18px]">{t("prof.left", { n: p.pack.left, total: p.pack.total })}</b><div className="small muted">{t("prof.packAuto")}</div></div>
            </div>
          ) : <p className="hint m-0">{t("prof.noPack")}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn primary sm" disabled={pending} onClick={() => run(() => requestPackPayment(p.id), () => setSaved(false))}><Icon name="msg" size="sm" />{t("prof.requestPay")}</button>
            <button className="btn secondary sm" onClick={() => { setNp({ n: mainN, price: packs.find((x) => x.n === mainN)?.price || (Number(price) || 0) * mainN }); setNewPack(true); }}><Icon name="plus" size="sm" />{t("prof.newPack")}</button>
          </div>
        </div>
      )}
      {payType === "POSTPAID" && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-sep pt-5">
          <button className="btn primary sm" disabled={pending} onClick={() => run(() => billNow(p.id))}><Icon name="msg" size="sm" />{t("pay.billNow")}</button>
          <span className="small muted">{t("pay.billNowHint")}</span>
        </div>
      )}
      <div className="mt-5 border-t border-sep pt-4">{t("prof.thisMonth")} <b className="text-[20px]">{earnedMonth}</b> {t("prof.earnedWord")}</div>

      <Dialog open={newPack} onClose={() => setNewPack(false)} title={t("prof.newPack")}>
        <div className="grid grid-cols-2 gap-3">
          <div className="field"><label htmlFor="np-n">{t("prof.packLessons")}</label><input id="np-n" className="input" inputMode="numeric" value={np.n || ""} onChange={(e) => setNp({ ...np, n: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
          <div className="field"><label htmlFor="np-p">{t("prof.packPrice")}</label><input id="np-p" className="input" inputMode="numeric" value={np.price || ""} onChange={(e) => setNp({ ...np, price: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
        </div>
        <p className="hint mt-3 mb-0">{t("prof.newPackHint")}</p>
        {error && <div className="alert mt-3">{error}</div>}
        <div className="actions">
          <button className="btn secondary" onClick={() => setNewPack(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending} onClick={() => run(() => addPack(p.id, np.n, np.price), () => setNewPack(false))}>{t("prof.addPack")}</button>
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
