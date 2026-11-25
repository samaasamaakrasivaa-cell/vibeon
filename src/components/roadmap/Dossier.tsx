"use client";
// Досье ученика: темы по итогам уроков (освоено / на контроле / пробел), порог, итоги уроков с проверкой
// сомнительных ответов («Засчитать» / «Оставить ошибкой» / «Добавить в варианты ответа») и «Утвердить» — тогда видит ученик.
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { DossierTopic, SummaryView } from "@/lib/lessons/dossier";
import { addToKey, approveSummary, buildSummaryFor, rebuildSummary, resolveCheck, setThreshold } from "@/lib/lessons/actions";
import { useRun } from "../courses/useRun";
import { Icon } from "../Icon";
import { Rich, StepHead } from "./RouteBrief";

const ST: Record<DossierTopic["status"], string> = { own: "green", watch: "orange", gap: "red" };

function LessonSum({ s, studentId }: { s: SummaryView; studentId: string }) {
  const { t, lang } = useT();
  const { run, pending, error } = useRun();
  const pend = s.checks.filter((c) => c.status === "pending");
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  void studentId;
  const [open, setOpen] = useState(pend.length > 0);
  return (
    <details className="dsum" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className="grow"><b>{s.title || t("ds.lesson")}</b> <span className="small muted">· {new Date(s.date).toLocaleDateString(loc, { day: "numeric", month: "short" })}</span></span>
        {pend.length > 0 && <span className="pill orange">{t("ds.toCheck", { n: pend.length })}</span>}
        {s.status === "approved" ? <span className="pill green">{t("ds.approved")}</span> : <span className="pill grey">{t("ds.draft")}</span>}
        <Icon name="chevd" size="sm" />
      </summary>
      <div className="dsum-body">
        {s.notes?.points?.length > 0 && <ul className="rbul">{s.notes.points.map((x, i) => <li key={i}><Rich text={x} /></li>)}</ul>}
        {s.topics.length > 0 && (
          <table className="tpack-tbl mt-2"><tbody>
            {s.topics.map((x) => <tr key={x.key}><td>{x.name}</td><td className="num muted">{t("ds.firstTry", { a: x.firstOk, b: x.items })}</td><td className="num"><b className={x.score >= 90 ? "text-ok" : x.score < 75 ? "text-bad" : ""}>{x.score}%</b></td></tr>)}
          </tbody></table>
        )}
        {pend.length > 0 && (
          <div className="dchk">
            <div className="small font-bold">{t("ds.checkT")}</div>
            <span className="hint">{t("ds.checkHint")}</span>
            {pend.map((c) => (
              <div key={c.id} className="dchk-row">
                <div className="small muted">{c.title}</div>
                {c.ctx && <div className="small">{c.ctx}</div>}
                <div className="small"><span className="text-bad">{t("ds.given")}: <b>{c.given}</b></span> · <span className="muted">{t("ds.key")}: {c.expected}</span></div>
                {c.why && <div className="small"><span className="ttag-ai">{t("tg.ai")}</span> {c.why}</div>}
                <div className="flex flex-wrap gap-2">
                  <button className="btn primary sm" disabled={pending} onClick={() => run(() => resolveCheck(s.id, c.id, true))}><Icon name="check" size="sm" />{t("ds.accept")}</button>
                  <button className="btn secondary sm" disabled={pending} onClick={() => run(() => resolveCheck(s.id, c.id, false))}>{t("ds.keep")}</button>
                  <button className="btn plain sm" disabled={pending} title={t("ds.addKeyHint")} onClick={() => run(() => addToKey(s.id, c.id))}><Icon name="plus" size="sm" />{t("ds.addKey")}</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {(s.notes?.words?.length ?? 0) > 0 && <div className="small mt-2"><b>{t("ds.words")}:</b> {s.notes.words.join(", ")}</div>}
        <div className="mt-2 flex flex-wrap gap-2">
          {s.status === "approved" ? <button className="btn plain sm" disabled={pending} onClick={() => run(() => approveSummary(s.id, false))}>{t("ds.unapprove")}</button>
            : <button className="btn primary sm" disabled={pending} onClick={() => run(() => approveSummary(s.id))}><Icon name="check" size="sm" />{t("ds.approve")}</button>}
          <button className="btn plain sm" disabled={pending} onClick={() => run(() => rebuildSummary(s.id))}><Icon name="undo" size="sm" />{t("ds.rebuild")}</button>
        </div>
        {error && <div className="alert">{error}</div>}
      </div>
    </details>
  );
}

export function Dossier({ studentId, topics, summaries, words, threshold, noSummary }: { studentId: string; topics: DossierTopic[]; summaries: SummaryView[]; words: string[]; threshold: number; noSummary: { id: string; date: string; title: string }[] }) {
  const { t, lang } = useT();
  const { run, pending } = useRun();
  const [thr, setThr] = useState(String(threshold));
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const pendAll = summaries.reduce((a, s) => a + s.checks.filter((c) => c.status === "pending").length, 0);
  return (
    <section className="card flex flex-col gap-3 dossier">
      <StepHead n="◎" title={t("ds.title")} sub={t("ds.sub")} right={pendAll > 0 ? <span className="pill orange">{t("ds.toCheck", { n: pendAll })}</span> : undefined} />
      <div className="flex flex-wrap items-center gap-2 small">
        <span>{t("ds.thr")}</span>
        <input className="input xs" style={{ width: 60 }} inputMode="numeric" value={thr} onChange={(e) => setThr(e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label={t("ds.thr")} />
        <span>%</span>
        {Number(thr) !== threshold && <button className="btn plain sm" disabled={pending} onClick={() => run(() => setThreshold(studentId, Number(thr) || 75))}>{t("common.save")}</button>}
        <span className="muted">{t("ds.legend", { a: threshold })}</span>
      </div>
      {topics.length ? (
        <div className="dtopics">
          {topics.map((x) => (
            <div key={x.key} className={`dtopic ${x.status}`}>
              <div className="flex items-center gap-2"><b className="grow">{x.name}</b><span className={`pill ${ST[x.status]}`}>{t(`ds.st.${x.status}`)}</span></div>
              <div className="dbar"><span style={{ width: `${x.score}%` }} /><i style={{ left: `${threshold}%` }} /></div>
              <div className="small muted">{x.score}%{x.trend !== null ? ` · ${x.trend > 0 ? "▲" : x.trend < 0 ? "▼" : "="}${Math.abs(x.trend)}` : ""} · {t("ds.lessons", { n: x.lessons })} · {t("ds.last", { d: new Date(x.last).toLocaleDateString(loc, { day: "numeric", month: "short" }) })}{x.daysAgo > 21 ? ` · ${t("ds.long")}` : ""}</div>
            </div>
          ))}
        </div>
      ) : <p className="hint m-0">{t("ds.empty")}</p>}
      {words.length > 0 && <details className="tpack-sec"><summary><span className="grow">{t("ds.wordsAll")}</span><span className="pill grey">{words.length}</span><Icon name="chevd" size="sm" /></summary><div className="small">{words.join(", ")}</div></details>}
      {summaries.length > 0 && <div className="small font-bold mt-1">{t("ds.byLesson")}</div>}
      {summaries.map((s) => <LessonSum key={s.id} s={s} studentId={studentId} />)}
      {noSummary.length > 0 && (
        <div className="small">
          <div className="muted">{t("ds.noSum")}</div>
          <div className="mt-1 flex flex-wrap gap-2">{noSummary.map((l) => <button key={l.id} className="btn plain sm" disabled={pending} onClick={() => run(() => buildSummaryFor(l.id, studentId))}>{l.title || t("ds.lesson")} · {new Date(l.date).toLocaleDateString(loc, { day: "numeric", month: "short" })}</button>)}</div>
        </div>
      )}
    </section>
  );
}
