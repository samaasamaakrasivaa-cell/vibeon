"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { saveReport, sendReport } from "@/lib/placement/actions";
import { defaultOn, R_BLOCKS, R_STUDENT_ONLY, R_TEXT, type RBlock, type RCfg, type RLang, type RVariant } from "@/lib/placement/report";
import type { ReportDataT } from "@/lib/placement/report-data";
import type { PublicationStamp } from "@/lib/placement/report-publication";
import { Icon } from "../Icon";
import { ReportSheet } from "./ReportSheet";

type Drafts = Record<RVariant, Record<RLang, Record<string, string>>>;

export function ReportBuilder({ id, r, drafts, canSend, back, source, publication, publicationEnabled, draftIds, timeZone }: {
  id: string; r: ReportDataT; drafts: Drafts; canSend: boolean; back: string;
  source: string; publication: PublicationStamp; publicationEnabled: boolean; draftIds: Partial<Record<RVariant, string>>; timeZone: string;
}) {
  const { t } = useT();
  // три листа: отчёт ученику, отчёт родителям и отдельный «Разбор ответов» (все вопросы или только ошибки)
  const [tab, setTab] = useState<RVariant | "answers">("student");
  const [wrongOnly, setWrongOnly] = useState(false);
  const v: RVariant = tab === "answers" ? "student" : tab;
  const [cfg, setCfg] = useState<Record<RVariant, RCfg>>(() => ({
    student: { lang: r.saved.student?.lang ?? "ru", on: { ...defaultOn("student"), ...(r.saved.student?.on ?? {}) }, texts: r.saved.student?.texts ?? {} },
    parent: { lang: r.saved.parent?.lang ?? "ru", on: { ...defaultOn("parent"), ...(r.saved.parent?.on ?? {}) }, texts: r.saved.parent?.texts ?? {} },
  }));
  const [published, setPublished] = useState(publication);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const writing = useRef(Promise.resolve());
  const draftVersions = useRef(draftIds);
  const savedCfg = useRef({ student: JSON.stringify(cfg.student), parent: JSON.stringify(cfg.parent) });
  const saveRequest = useRef<Partial<Record<RVariant, { cfg: string; id: string }>>>({});
  const sendRequest = useRef<{ cfg: string; id: string } | null>(null);
  const sending = useRef(false);
  const c = cfg[v], lang = c.lang;
  const on = Object.fromEntries(R_BLOCKS.map((b) => [b, v === "parent" && R_STUDENT_ONLY.includes(b) ? false : !!c.on[b]])) as Record<RBlock, boolean>;
  const texts = Object.fromEntries(R_TEXT.map((b) => [b, c.texts[`${lang}:${b}`] ?? drafts[v][lang][b] ?? ""]));
  const set = (patch: Partial<RCfg>) => setCfg((x) => ({ ...x, [v]: { ...x[v], ...patch } }));
  const setText = (b: RBlock, s: string) => set({ texts: { ...c.texts, [`${lang}:${b}`]: s } });
  const resetText = (b: RBlock) => { const n = { ...c.texts }; delete n[`${lang}:${b}`]; set({ texts: n }); };

  const persist = (v: RVariant, next: RCfg) => {
    const work = writing.current.then(async () => {
      const key = JSON.stringify(next);
      if (savedCfg.current[v] === key) return;
      const request = saveRequest.current[v];
      const version = request?.cfg === key ? request.id : crypto.randomUUID();
      saveRequest.current[v] = { cfg: key, id: version };
      const res = await saveReport(id, v, next, draftVersions.current[v] ?? null, version).catch(() => null);
      if (!res?.ok) { setMsg(t("rp.draftFailed")); return; }
      draftVersions.current = { ...draftVersions.current, [v]: version };
      savedCfg.current[v] = key;
      delete saveRequest.current[v];
    });
    writing.current = work;
    return work;
  };

  // Автосохранение записывает только изменившийся черновик.
  useEffect(() => {
    const h = setTimeout(() => { void persist("student", cfg.student); void persist("parent", cfg.parent); }, 800);
    return () => clearTimeout(h);
    // Сохранение привязано к изменению конфигурации, очередь и версии живут в refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, id]);

  const pdf = () => start(async () => {
    if (tab !== "answers") await persist(v, cfg[v]);
    setTimeout(() => window.print(), 50);
  });
  const send = (val: boolean) => {
    if (sending.current) return;
    sending.current = true;
    setMsg(null);
    const work = writing.current.then(async () => {
      const key = JSON.stringify(cfg.student);
      const request = sendRequest.current;
      const requestId = val ? (request?.cfg === key ? request.id : crypto.randomUUID()) : null;
      if (requestId) sendRequest.current = { cfg: key, id: requestId };
      const res = await sendReport(id, requestId
        ? { on: true, expected: published, id: requestId, cfg: cfg.student, draftId: draftVersions.current.student ?? null, source }
        : { on: false, expected: published }).catch(() => null);
      if (!res?.ok) {
        const errors = { level: "rp.needLevel", visibility: "rp.needVisibility", paused: "rp.publishingPaused", recipient: "rp.needRecipient" } as const;
        setMsg(t(res ? errors[res.error as keyof typeof errors] ?? "rp.reportChanged" : "pl.err.net"));
        return;
      }
      if (requestId) {
        draftVersions.current = { ...draftVersions.current, student: requestId };
        savedCfg.current.student = key;
      }
      sendRequest.current = null;
      setPublished({ sent: val, version: requestId ?? published.version });
      setMsg(t(val ? "rp.sentOk" : "rp.unsentOk"));
    }).finally(() => { sending.current = false; });
    writing.current = work;
    start(() => work);
  };
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
              {published.sent && <div className="flex flex-wrap items-center gap-2"><span className="pill green">{t("rp.sent")}</span><button type="button" className="btn plain sm" disabled={pending} onClick={() => send(false)}>{t("rp.unsend")}</button></div>}
              {publicationEnabled
                ? <button type="button" className="btn secondary self-start" disabled={pending} onClick={() => send(true)}><Icon name="send" size="sm" />{t(published.sent ? "rp.resend" : "rp.send")}</button>
                : <span className="small muted">{t("rp.publishingPaused")}</span>}
            </div>
          )}
          {v === "parent" && <p className="small muted m-0"><Icon name="lock" size="sm" /> {t("rp.parentOnly")}</p>}
          {msg && <div className="small" role="status">{msg}</div>}
          <p className="small muted m-0">{t("rp.printHint")}</p>
        </aside>}
        <div className={`rpt-preview ${tab === "answers" ? "wide" : ""}`}>{tab === "answers" ? <ReportSheet r={r} v="student" lang="ru" on={on} texts={texts} timeZone={timeZone} answers wrongOnly={wrongOnly} /> : <ReportSheet r={r} v={v} lang={lang} on={on} texts={texts} timeZone={timeZone} />}</div>
      </div>
    </div>
  );
}
