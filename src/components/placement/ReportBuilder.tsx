"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { saveReport, sendReport } from "@/lib/placement/actions";
import { defaultOn, R_BLOCKS, R_STUDENT_ONLY, R_TEXT, type RBlock, type RCfg, type RLang, type RVariant } from "@/lib/placement/report";
import type { ReportDataT } from "@/lib/placement/report-data";
import { Icon } from "../Icon";
import { ReportSheet } from "./ReportSheet";

type Drafts = Record<RVariant, Record<RLang, Record<string, string>>>;

export function ReportBuilder({ id, r, drafts, canSend, back }: { id: string; r: ReportDataT; drafts: Drafts; canSend: boolean; back: string }) {
  const { t } = useT();
  // три листа: отчёт ученику, отчёт родителям и отдельный «Разбор ответов» (все вопросы или только ошибки)
  const [tab, setTab] = useState<RVariant | "answers">("student");
  const [wrongOnly, setWrongOnly] = useState(false);
  const v: RVariant = tab === "answers" ? "student" : tab;
  const [cfg, setCfg] = useState<Record<RVariant, RCfg>>(() => ({
    student: { lang: r.saved.student?.lang ?? "ru", on: { ...defaultOn("student"), ...(r.saved.student?.on ?? {}) }, texts: r.saved.student?.texts ?? {} },
    parent: { lang: r.saved.parent?.lang ?? "ru", on: { ...defaultOn("parent"), ...(r.saved.parent?.on ?? {}) }, texts: r.saved.parent?.texts ?? {} },
  }));
  const [sent, setSent] = useState(!!r.saved.sent);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const c = cfg[v], lang = c.lang;
  const on = Object.fromEntries(R_BLOCKS.map((b) => [b, v === "parent" && R_STUDENT_ONLY.includes(b) ? false : !!c.on[b]])) as Record<RBlock, boolean>;
  const texts = Object.fromEntries(R_TEXT.map((b) => [b, c.texts[`${lang}:${b}`] ?? drafts[v][lang][b] ?? ""]));
  const set = (patch: Partial<RCfg>) => setCfg((x) => ({ ...x, [v]: { ...x[v], ...patch } }));
  const setText = (b: RBlock, s: string) => set({ texts: { ...c.texts, [`${lang}:${b}`]: s } });
  const resetText = (b: RBlock) => { const n = { ...c.texts }; delete n[`${lang}:${b}`]; set({ texts: n }); };

  // автосохранение — через 0,8 с после правки
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = setTimeout(() => { void saveReport(id, "student", cfg.student); void saveReport(id, "parent", cfg.parent); }, 800);
    return () => clearTimeout(h);
  }, [cfg, id]);

  const pdf = () => start(async () => {
    if (tab !== "answers") await saveReport(id, v, cfg[v]).catch(() => null);
    setTimeout(() => window.print(), 50);
  });
  const send = (val: boolean) => start(async () => {
    setMsg(null);
    await saveReport(id, "student", cfg.student).catch(() => null);
    const res = await sendReport(id, val).catch(() => null);
    if (res?.ok) { setSent(val); setMsg(t(val ? "rp.sentOk" : "rp.unsentOk")); }
    else setMsg(t(res?.error === "level" ? "rp.needLevel" : "pl.err.net"));
  });
  const blocks = R_BLOCKS.filter((b) => b !== "answers" && (v === "student" || !R_STUDENT_ONLY.includes(b))); // разбор ответов — отдельным листом

  return (
    <div className="rpt-page">
      <div className="rpt-bar noprint">
        <Link href={back} className="small muted">← {t("rp.back")}</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label={t("rp.variant")}>
            {(["student", "parent", "answers"] as const).map((k) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{t(`rp.v.${k}` as DictKey)}</button>)}
          </div>
          {tab === "answers" ? (
            <div className="seg" role="group" aria-label={t("rp.ansWhich")}>
              <button type="button" aria-pressed={!wrongOnly} onClick={() => setWrongOnly(false)}>{t("rp.ansAll")}</button>
              <button type="button" aria-pressed={wrongOnly} onClick={() => setWrongOnly(true)}>{t("rp.ansWrong")}</button>
            </div>
          ) : <div className="seg" role="group" aria-label={t("rp.lang")}>
            {(["ru", "en"] as const).map((k) => <button key={k} type="button" aria-pressed={lang === k} onClick={() => set({ lang: k })}>{k === "ru" ? "Русский" : "English"}</button>)}
          </div>}
          <button type="button" className="btn primary" disabled={pending} onClick={pdf}><Icon name="dl" size="sm" />{t("rp.pdf")}</button>
        </div>
      </div>
      <p className="small muted noprint mt-0">{tab === "answers" ? t("rp.leadAnswers") : <>{t(v === "student" ? "rp.leadStudent" : "rp.leadParent")} {lang === "en" && t("rp.enNote")}</>}</p>

      <div className="rpt-grid">
        {tab !== "answers" && <aside className="rpt-side noprint">
          <h3 className="mt-0">{t("rp.blocks")}</h3>
          {blocks.map((b) => (
            <div key={b} className="rpt-opt">
              <label className="flex items-center gap-2"><input type="checkbox" checked={on[b]} onChange={(e) => set({ on: { ...c.on, [b]: e.target.checked } })} /><b className="small">{t(`rp.b.${b}` as DictKey)}</b></label>
              {R_TEXT.includes(b) && on[b] && (
                <>
                  <textarea className="input" rows={b === "level" || b === "plan" ? 5 : 4} value={texts[b]} placeholder={b === "comment" ? t("rp.commentPh") : undefined} onChange={(e) => setText(b, e.target.value)} />
                  {c.texts[`${lang}:${b}`] !== undefined && b !== "comment" && <button type="button" className="btn plain sm self-start" onClick={() => resetText(b)}>{t("rp.reset")}</button>}
                </>
              )}
            </div>
          ))}
          {v === "student" && canSend && (
            <div className="rpt-send">
              <b className="small">{t("rp.cabinet")}</b>
              <span className="small muted">{t("rp.cabinetHint")}</span>
              {sent
                ? <div className="flex flex-wrap items-center gap-2"><span className="pill green">{t("rp.sent")}</span><button type="button" className="btn plain sm" disabled={pending} onClick={() => send(false)}>{t("rp.unsend")}</button></div>
                : <button type="button" className="btn secondary self-start" disabled={pending} onClick={() => send(true)}><Icon name="send" size="sm" />{t("rp.send")}</button>}
            </div>
          )}
          {v === "parent" && <p className="small muted m-0"><Icon name="lock" size="sm" /> {t("rp.parentOnly")}</p>}
          {msg && <div className="small" role="status">{msg}</div>}
          <p className="small muted m-0">{t("rp.printHint")}</p>
        </aside>}
        <div className={`rpt-preview ${tab === "answers" ? "wide" : ""}`}>{tab === "answers" ? <ReportSheet r={r} v="student" lang="ru" on={on} texts={texts} answers wrongOnly={wrongOnly} /> : <ReportSheet r={r} v={v} lang={lang} on={on} texts={texts} />}</div>
      </div>
    </div>
  );
}
