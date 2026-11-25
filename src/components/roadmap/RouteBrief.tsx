"use client";
// Маршрут v2 у учителя: «Что я понял» (вывод ИИ), анкета-рубрики с диктовкой, карточка точки, диалог с версиями.
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { analyzeArticle, refineRoadmap, removeArticle, restoreVersion, routeInsight, saveBrief, saveInsight, savePoint, suggestPoint, type Brief, type ChatMsg, type InsightSaved } from "@/lib/roadmap/ai-route";
import type { RoadmapForm } from "@/lib/roadmap/actions";
import { REC_LISTS, REC_TEXTS, type Article, type Point, type PointOk, type Theme } from "@/lib/ai/route-core";
import { extractFile } from "../ai/BookImport";
import { SKILL_NAME, SKILLS, txt } from "@/lib/roadmap/cefr";
import { useRun } from "../courses/useRun";
import { Dictate } from "../ai/Dictate";
import { Icon } from "../Icon";

const add = (a: string | undefined, b: string) => `${a ? `${a.trimEnd()} ` : ""}${b}`.trim();

/** Заголовок блока-шага: номер, название, короткая подпись, справа — метки и кнопки. */
export function StepHead({ n, title, sub, right, ai }: { n: number | string; title: string; sub?: string; right?: React.ReactNode; ai?: boolean }) {
  return (
    <div className="stephead">
      <span className={`stepn ${ai ? "ai" : ""}`}>{n}</span>
      <div className="min-w-0"><h3>{title}</h3>{sub && <div className="stepsub">{sub}</div>}</div>
      {right && <div className="stepright">{right}</div>}
    </div>
  );
}

// ───────── «Что я понял» ─────────

export function InsightCard({ studentId, f, brief, insight, hasPack }: { studentId: string; f: RoadmapForm; brief: Brief; insight: InsightSaved | null; hasPack: boolean }) {
  const { t } = useT();
  const { run, pending, error } = useRun();
  const [edit, setEdit] = useState(false);
  const [sum, setSum] = useState(insight?.summary ?? "");
  const [gaps, setGaps] = useState(insight?.gaps ?? []);
  const [extra, setExtra] = useState(insight?.extra ?? "");
  useEffect(() => { setSum(insight?.summary ?? ""); setGaps(insight?.gaps ?? []); setExtra(insight?.extra ?? ""); }, [insight]);
  // ИИ сам изучает комплект, как только он есть, — до того, как учитель что-то заполнит
  const auto = useRef(false);
  useEffect(() => { if (!insight && hasPack && !auto.current) { auto.current = true; run(() => routeInsight(studentId, f, brief)); } }, [insight, hasPack]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (i: number, d: -1 | 1) => { const n = [...gaps]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setGaps(n); };
  return (
    <section className="card flex flex-col gap-3 rinsight">
      <StepHead n={3} ai title={t("rm2.insight")} sub={t("rm2.insightSub")} right={<>
        {insight?.confirmed && <span className="pill green"><Icon name="check" size="sm" />{t("rm2.confirmed")}</span>}
        {insight && !edit && <button className="btn plain sm" onClick={() => setEdit(true)}><Icon name="pencil" size="sm" />{t("rm2.fix")}</button>}
      </>} />
      {!insight ? (
        pending ? <div className="dict-bar busy"><span className="dict-spin" /><span>{t("rm2.reading")}</span></div>
          : <><p className="hint m-0">{hasPack ? t("rm2.insightHint") : t("rm2.insightNoPack")}</p><button className="btn tinted self-start" onClick={() => run(() => routeInsight(studentId, f, brief))}><Icon name="spark" size="sm" />{t("rm2.insightGo")}</button></>
      ) : (
        <>
          {edit ? <textarea className="textarea" rows={6} value={sum} onChange={(e) => setSum(e.target.value)} aria-label={t("rm2.insight")} /> : <p className="m-0" style={{ whiteSpace: "pre-wrap" }}>{insight.summary}</p>}
          {insight.blockers.length > 0 && <div><div className="small font-bold">{t("rm2.blockers")}</div><ul className="m-0 pl-5 small">{insight.blockers.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {gaps.length > 0 && (
            <div>
              <div className="small font-bold">{t("rm2.gaps")}</div>
              <ol className="rgaps">
                {gaps.map((g, i) => (
                  <li key={g.topic + i}><span className="grow"><b>{g.topic}</b>{g.level && <span className="muted"> · {g.level}</span>}{g.why && <div className="small muted">{g.why}</div>}</span>
                    {edit && <span className="flex gap-1"><button className="iconbtn" aria-label="up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button className="iconbtn" aria-label="down" disabled={i === gaps.length - 1} onClick={() => move(i, 1)}>↓</button><button className="iconbtn" aria-label={t("common.delete")} onClick={() => setGaps(gaps.filter((_, k) => k !== i))}><Icon name="close" size="sm" /></button></span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {insight.strengths.length > 0 && <div className="small"><b>{t("rm2.strengths")}:</b> {insight.strengths.join(" · ")}</div>}
          {insight.dynamics && <div className="small"><b>{t("rm2.dynamics")}:</b> {insight.dynamics}</div>}
          <div className="flex flex-wrap items-center gap-2">
            {edit ? <>
              <button className="btn primary sm" disabled={pending} onClick={() => run(() => saveInsight(studentId, { summary: sum, gaps, extra: insight.extra ?? "", confirmed: !!insight.confirmed }), () => setEdit(false))}>{t("common.save")}</button>
              <button className="btn secondary sm" onClick={() => { setEdit(false); setSum(insight.summary); setGaps(insight.gaps); }}>{t("common.cancel")}</button>
            </> : <button className="btn plain sm" disabled={pending} onClick={() => run(() => routeInsight(studentId, f, brief))}><Icon name="spark" size="sm" />{pending ? t("rm2.reading") : t("rm2.insightAgain")}</button>}
            <span className="small muted grow text-right">{insight.label}{insight.edited ? ` · ${t("rm2.edited")}` : ""}</span>
          </div>
          {!edit && (
            <div className="rconf">
              <div className="small font-bold">{t("rm2.extraT")}</div>
              <div className="dictbox">
                <textarea className="textarea" rows={2} value={extra} placeholder={t("rm2.extraPh")} aria-label={t("rm2.extraT")} onChange={(e) => setExtra(e.target.value)} />
                <Dictate round onText={(x) => setExtra((v) => add(v, x))} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn primary sm" disabled={pending} onClick={() => run(() => saveInsight(studentId, { summary: insight.summary, gaps: insight.gaps, extra, confirmed: true }))}><Icon name="check" size="sm" />{insight.confirmed ? t("rm2.confirmAgain") : t("rm2.confirm")}</button>
                {extra !== (insight.extra ?? "") && <button className="btn secondary sm" disabled={pending} onClick={() => run(() => saveInsight(studentId, { summary: insight.summary, gaps: insight.gaps, extra, confirmed: !!insight.confirmed }))}>{t("rm2.saveExtra")}</button>}
              </div>
              <span className="hint">{t("rm2.confirmHint")}</span>
            </div>
          )}
        </>
      )}
      {error && <div className="alert">{error}</div>}
    </section>
  );
}

// ───────── Анкета ─────────

type RubricKey = "background" | "goal" | "skills" | "priorities" | "character" | "interests" | "materials" | "include" | "other";
const RUBRICS: RubricKey[] = ["background", "goal", "skills", "priorities", "character", "interests", "materials", "include", "other"];

export function useBrief(studentId: string, f: RoadmapForm, initial: Brief) {
  const [brief, setBrief] = useState<Brief>(initial);
  const [saved, setSaved] = useState(true);
  const first = useRef(true);
  const fr = useRef(f); fr.current = f;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaved(false);
    const h = setTimeout(() => { saveBrief(studentId, fr.current, brief).then(() => setSaved(true)).catch(() => {}); }, 1200);
    return () => clearTimeout(h);
  }, [brief, studentId]);
  return { brief, setBrief, saved };
}

export function BriefForm({ brief, setBrief, saved }: { brief: Brief; setBrief: (fn: (b: Brief) => Brief) => void; saved: boolean }) {
  const { t, lang } = useT();
  const set = (k: RubricKey, v: string) => setBrief((b) => ({ ...b, [k]: v }));
  const filled = RUBRICS.filter((k) => (brief[k] ?? "").trim() || (k === "skills" && Object.keys(brief.marks ?? {}).length) || (k === "priorities" && (brief.order ?? []).length)).length;
  return (
    <section className="card flex flex-col gap-2 rbrief">
      <StepHead n={5} title={t("rm2.brief")} sub={t("rm2.briefHint")} right={<span className="small muted">{t("rm2.filled", { n: filled, m: RUBRICS.length })}{saved ? "" : " · …"}</span>} />
      {RUBRICS.map((k) => {
        const v = brief[k] ?? "";
        return (
          <details key={k} className="rrub" open={k === "goal" && !v}>
            <summary><span className={`rrub-dot ${v.trim() || (k === "skills" && Object.keys(brief.marks ?? {}).length) || (k === "priorities" && (brief.order ?? []).length) ? "on" : ""}`} /><span className="grow">{t(`rm2.r.${k}`)}</span><Icon name="chevd" size="sm" /></summary>
            <div className="rrub-body">
              <ul className="rrub-hints">{t(`rm2.h.${k}`).split("|").map((h, i) => <li key={i}>{h}</li>)}</ul>
              {k === "skills" && (
                <div className="rskills">
                  {SKILLS.map((s) => (
                    <div key={s} className="rskill"><span>{txt(SKILL_NAME[s], lang)}</span>
                      <div className="seg sm">{(["weak", "norm", "strong"] as const).map((m) => <button key={m} type="button" aria-pressed={brief.marks?.[s] === m} onClick={() => setBrief((b) => ({ ...b, marks: { ...(b.marks ?? {}), [s]: b.marks?.[s] === m ? undefined as never : m } }))}>{t(`rm2.m.${m}`)}</button>)}</div>
                    </div>
                  ))}
                </div>
              )}
              {k === "priorities" && (
                <div className="flex flex-wrap gap-1.5">
                  {SKILLS.map((s) => { const i = (brief.order ?? []).indexOf(s); return (
                    <button key={s} type="button" className={`pchip ${i >= 0 ? "on" : ""}`} aria-pressed={i >= 0} onClick={() => setBrief((b) => { const o = b.order ?? []; return { ...b, order: o.includes(s) ? o.filter((x) => x !== s) : [...o, s] }; })}>{i >= 0 ? `${i + 1}. ` : ""}{txt(SKILL_NAME[s], lang)}</button>
                  ); })}
                  <span className="hint w-full">{t("rm2.orderHint")}</span>
                </div>
              )}
              {k === "goal" && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="seg sm" role="group" aria-label={t("rm2.variant")}>{(["br", "am", "any"] as const).map((x) => <button key={x} type="button" aria-pressed={brief.variant === x} onClick={() => setBrief((b) => ({ ...b, variant: x }))}>{t(`rm2.v.${x}`)}</button>)}</div>
                  <select className="select xs" value={brief.exam ?? ""} aria-label={t("rm2.exam")} onChange={(e) => setBrief((b) => ({ ...b, exam: e.target.value }))}>
                    <option value="">{t("rm2.noExam")}</option>{["IELTS", "CAE", "CPE", "FCE", "TOEFL", "ЕГЭ", "ОГЭ"].map((x) => <option key={x}>{x}</option>)}
                  </select>
                </div>
              )}
              {k === "other" && <input className="input" value={brief.breaks ?? ""} placeholder={t("rm2.breaksPh")} aria-label={t("rm2.breaks")} onChange={(e) => setBrief((b) => ({ ...b, breaks: e.target.value }))} />}
              <div className="dictbox">
                <textarea className="textarea" rows={3} value={v} aria-label={t(`rm2.r.${k}`)} placeholder={t("rm2.typeOr")} onChange={(e) => set(k, e.target.value)} />
                <Dictate round onText={(x) => setBrief((b) => ({ ...b, [k]: add(b[k], x) }))} />
              </div>
            </div>
          </details>
        );
      })}
    </section>
  );
}

// ───────── Карточка точки ─────────

const okOf = (p: Point): PointOk => p.ok ?? {};

export function PointCard({ roadmapId, p, onClose, happiful }: { roadmapId: string; p: Point; onClose: () => void; happiful?: boolean }) {
  const { t } = useT();
  const { run, pending, error } = useRun();
  const [ok, setOk] = useState<PointOk>(okOf(p));
  const [own, setOwn] = useState<Record<string, string>>({});
  const [hours, setHours] = useState(String(p.hours));
  // несохранённые отметки не теряются, когда точка обновилась (например, после разбора статьи); сброс — только при смене точки
  useEffect(() => { setOk(okOf(p)); setHours(String(p.hours)); }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // подсказки ИИ появляются сами при первом открытии точки
  const asked = useRef<string | null>(null);
  useEffect(() => { if (!p.recs && asked.current !== p.id) { asked.current = p.id; run(() => suggestPoint(roadmapId, p.id)); } }, [p.id, p.recs]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: (typeof REC_LISTS)[number], x: string) => setOk((o) => { const cur = o[k] ?? []; return { ...o, [k]: cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x] }; });
  const addOwn = (k: (typeof REC_LISTS)[number]) => { const v = (own[k] ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean); if (!v.length) return; setOk((o) => ({ ...o, [k]: [...new Set([...(o[k] ?? []), ...v])] })); setOwn((s) => ({ ...s, [k]: "" })); };
  const dirty = JSON.stringify(ok) !== JSON.stringify(okOf(p)) || Number(hours) !== p.hours;
  return (
    <section className="card rpoint" aria-label={p.title}>
      <div className="flex items-start gap-2">
        <div className="grow"><div className="small muted">{t("rm2.point")} · {p.level}</div><h3 className="m-0">{p.title}</h3></div>
        <button className="iconbtn" aria-label={t("common.close")} onClick={onClose}><Icon name="close" size="sm" /></button>
      </div>
      {p.why && <p className="small m-0 mt-2"><b>{t("rm2.why")}:</b> {p.why}</p>}
      {p.focus && <p className="small m-0 mt-1"><b>{t("rm2.focus")}:</b> {p.focus}</p>}
      <div className="mt-2 flex items-center gap-2"><label className="small muted" htmlFor="pt-h">{t("rm.hours")}</label><input id="pt-h" className="input xs" style={{ width: 70 }} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, "").slice(0, 2))} />{p.hours_why && <span className="small muted">{t("rm2.hoursWhy")}: {p.hours_why}</span>}</div>
      <p className="hint mb-0 mt-3">{t("rm2.pointHint")}</p>
      {!p.recs && pending && <div className="dict-bar busy mt-2"><span className="dict-spin" /><span>{t("rm2.suggesting")}</span></div>}
      {/* на какой теме разбираем: темы ИИ с ключевыми словами и поиском + своя тема */}
      <div className="rrec">
        <div className="small font-bold">{t("rm3.themeT")}</div>
        <div className="rthemes">
          {(p.recs?.themes ?? []).map((th) => <ThemeCard key={th.title} th={th} on={ok.theme === th.title} happiful={!!happiful} onPick={() => setOk((o) => ({ ...o, theme: o.theme === th.title ? undefined : th.title }))} />)}
        </div>
        <div className="flex gap-2"><input className="input xs grow" value={(p.recs?.themes ?? []).some((x) => x.title === ok.theme) ? "" : ok.theme ?? ""} placeholder={t("rm3.ownTheme")} onChange={(e) => setOk((o) => ({ ...o, theme: e.target.value || undefined }))} /></div>
      </div>
      <ArticleBox roadmapId={roadmapId} pointId={p.id} articles={p.articles ?? []} ok={ok} setOk={setOk} />
      {REC_LISTS.map((k) => {
        const recs = p.recs?.[k] ?? [];
        const mine = (ok[k] ?? []).filter((x) => !recs.includes(x));
        return (
          <div key={k} className="rrec">
            <div className="small font-bold">{t(`rm2.k.${k}`)}</div>
            <div className="flex flex-wrap gap-1.5">
              {[...recs, ...mine].map((x) => { const on = (ok[k] ?? []).includes(x); return <button key={x} type="button" className={`pchip ${on ? "on" : ""}`} aria-pressed={on} title={on ? t("rm2.okOn") : t("rm2.okOff")} onClick={() => toggle(k, x)}>{on && "✓ "}{x}</button>; })}
            </div>
            <div className="mt-1 flex gap-2"><input className="input xs grow" value={own[k] ?? ""} placeholder={t("rm2.ownPh")} onChange={(e) => setOwn((s) => ({ ...s, [k]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOwn(k); } }} /><button type="button" className="btn plain sm" onClick={() => addOwn(k)}>{t("rm2.addOwn")}</button></div>
          </div>
        );
      })}
      {REC_TEXTS.map((k) => {
        const rec = p.recs?.[k] ?? "";
        const v = ok[k] ?? "";
        return (
          <div key={k} className="rrec">
            <div className="small font-bold">{t(`rm2.k.${k}`)}</div>
            {rec && rec !== v && <div className="rpf"><span className="small">{rec}</span><button type="button" className="btn plain sm" onClick={() => setOk((o) => ({ ...o, [k]: rec }))}>{t("rm2.okIt")}</button></div>}
            <textarea className="textarea" rows={2} value={v} placeholder={t("rm2.ownText")} onChange={(e) => setOk((o) => ({ ...o, [k]: e.target.value }))} />
          </div>
        );
      })}
      <div className="rrec">
        <div className="small font-bold">{t("rm2.note")}</div>
        <div className="dictbox">
          <textarea className="textarea" rows={3} value={ok.note ?? ""} placeholder={t("rm2.notePh")} onChange={(e) => setOk((o) => ({ ...o, note: e.target.value }))} />
          <Dictate round onText={(x) => setOk((o) => ({ ...o, note: add(o.note, x) }))} />
        </div>
      </div>
      {error && <div className="alert mt-2">{error}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn primary" disabled={pending || !dirty} onClick={() => run(() => savePoint(roadmapId, p.id, { ok, hours: Number(hours) || p.hours }))}><Icon name="check" size="sm" />{t("rm2.savePoint")}</button>
        <button className="btn plain" disabled={pending} onClick={() => run(() => suggestPoint(roadmapId, p.id))}><Icon name="spark" size="sm" />{t("rm2.moreIdeas")}</button>
      </div>
      <p className="hint mb-0 mt-2">{t("rm2.studentSees")}</p>
    </section>
  );
}

const gq = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
const yq = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

function ThemeCard({ th, on, onPick, happiful }: { th: Theme; on: boolean; onPick: () => void; happiful: boolean }) {
  const { t } = useT();
  return (
    <div className={`rtheme ${on ? "on" : ""}`}>
      <div className="flex items-start gap-2"><b className="grow">{th.title}</b><button type="button" className={`btn sm ${on ? "primary" : "secondary"}`} onClick={onPick}>{on ? `✓ ${t("rm3.picked")}` : t("rm3.pick")}</button></div>
      {th.why && <div className="small muted">{th.why}</div>}
      {th.keywords.length > 0 && <div className="flex flex-wrap gap-1">{th.keywords.map((k) => <span key={k} className="pill grey">{k}</span>)}</div>}
      {th.article && <div className="small"><b>{t("rm3.lookFor")}:</b> {th.article}</div>}
      <div className="rlinks small">
        {th.article_query && happiful && <a href={gq(`site:happiful.com ${th.article_query}`)} target="_blank" rel="noopener noreferrer">Happiful ↗</a>}
        {th.article_query && <a href={gq(`${th.article_query} article`)} target="_blank" rel="noopener noreferrer">{t("rm3.articles")} ↗</a>}
        {th.podcast_query && <a href={gq(`${th.podcast_query} podcast episode`)} target="_blank" rel="noopener noreferrer">{t("rm3.podcasts")} ↗</a>}
        {th.video_query && <a href={yq(th.video_query)} target="_blank" rel="noopener noreferrer">{t("rm3.videos")} ↗</a>}
      </div>
    </div>
  );
}

/** «Моя статья»: файл / фото / PDF, ссылка или текст → ИИ разбирает, что в ней есть; учитель утверждает. */
function ArticleBox({ roadmapId, pointId, articles, ok, setOk }: { roadmapId: string; pointId: string; articles: Article[]; ok: PointOk; setOk: (fn: (o: PointOk) => PointOk) => void }) {
  const { t } = useT();
  const { run, pending, error } = useRun();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [ferr, setFerr] = useState<string | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFerr(null); setBusy(t("rm3.reading"));
    try { const x = await extractFile(f); setText(x); setTitle((v) => v || f.name.replace(/\.[a-z0-9]+$/i, "")); }
    catch { setFerr(t("rm3.fileFail")); }
    setBusy(null);
  };
  const toggle = (k: "vocabulary" | "phrasal_verbs" | "idioms", x: string) => setOk((o) => { const cur = o[k] ?? []; return { ...o, [k]: cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x] }; });
  const shown = (a: Article) => (ok.materials ?? []).some((m) => m.title === a.title && m.url === a.url);
  return (
    <div className="rrec rart">
      <div className="small font-bold">{t("rm3.myArt")}</div>
      <span className="hint">{t("rm3.myArtHint")}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn secondary sm"><Icon name="clip" size="sm" />{t("rm3.file")}<input type="file" hidden accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        <input className="input xs grow" style={{ minWidth: 180 }} value={url} placeholder={t("rm3.urlPh")} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <details><summary className="small alink">{t("rm3.paste")}</summary>
        <textarea className="textarea mt-1" rows={4} value={text} placeholder={t("rm3.pastePh")} onChange={(e) => setText(e.target.value)} />
      </details>
      {(text || url) && <input className="input xs" value={title} placeholder={t("rm3.titlePh")} onChange={(e) => setTitle(e.target.value)} />}
      {text && <span className="small muted">{t("rm3.gotText", { n: text.split(/\s+/).filter(Boolean).length })}</span>}
      {busy && <div className="dict-bar busy"><span className="dict-spin" /><span>{busy}</span></div>}
      {pending && <div className="dict-bar busy"><span className="dict-spin" /><span>{t("rm3.analyzing")}</span></div>}
      <button type="button" className="btn tinted sm self-start" disabled={pending || !!busy || (!text.trim() && !url.trim())} onClick={() => run(() => analyzeArticle(roadmapId, pointId, { title, url, text }), () => { setText(""); setUrl(""); setTitle(""); })}><Icon name="spark" size="sm" />{t("rm3.analyze")}</button>
      {(ferr || error) && <div className="alert">{ferr || error}</div>}
      {articles.map((a) => (
        <div key={a.id} className="rartc">
          <div className="flex items-start gap-2">
            <div className="grow"><b>{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="alink">{a.title} ↗</a> : a.title}</b>{a.recs.summary && <div className="small muted">{a.recs.summary}</div>}</div>
            <button type="button" className="iconbtn" aria-label={t("common.delete")} onClick={() => confirm(t("rm3.delQ")) && run(() => removeArticle(roadmapId, pointId, a.id))}><Icon name="close" size="sm" /></button>
          </div>
          <label className="small flex items-center gap-2"><input type="checkbox" checked={shown(a)} onChange={(e) => setOk((o) => ({ ...o, materials: e.target.checked ? [...(o.materials ?? []), { title: a.title, url: a.url }] : (o.materials ?? []).filter((m) => !(m.title === a.title && m.url === a.url)) }))} />{t("rm3.showStudent")}</label>
          {(["vocabulary", "phrasal_verbs", "idioms"] as const).map((k) => a.recs[k].length > 0 && (
            <div key={k}><div className="small muted">{t(`rm2.k.${k}`)} · {t("rm3.fromText")}</div>
              <div className="flex flex-wrap gap-1.5">{a.recs[k].map((x) => { const on = (ok[k] ?? []).includes(x); return <button key={x} type="button" className={`pchip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggle(k, x)}>{on && "✓ "}{x}</button>; })}</div>
            </div>
          ))}
          {a.recs.grammar_examples.length > 0 && <div><div className="small muted">{t("rm3.gramEx")}</div><ul className="rbul small">{a.recs.grammar_examples.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {a.recs.grammar_note && <div className="small muted">{a.recs.grammar_note}</div>}
          {a.recs.reading_questions.length > 0 && (
            <div><div className="small muted">{t("rm3.questions")}</div><ol className="rnum small">{a.recs.reading_questions.map((x, i) => <li key={i}>{x}</li>)}</ol>
              <button type="button" className="btn plain sm" onClick={() => setOk((o) => ({ ...o, reading: `${a.title}${a.url ? ` (${a.url})` : ""}\n${a.recs.reading_questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}` }))}>{t("rm3.useQuestions")}</button></div>
          )}
          {(["speaking", "writing"] as const).map((k) => a.recs[k] && <div key={k} className="rpf"><span className="small"><b>{t(`rm2.k.${k}`)}:</b> {a.recs[k]}</span><button type="button" className="btn plain sm" onClick={() => setOk((o) => ({ ...o, [k]: a.recs[k] }))}>{t("rm2.okIt")}</button></div>)}
        </div>
      ))}
    </div>
  );
}

// ───────── Диалог и версии ─────────

export function RouteChat({ roadmapId, chat, versions }: { roadmapId: string; chat: ChatMsg[]; versions: { at: string; note: string }[] }) {
  const { t, lang } = useT();
  const { run, pending, error } = useRun();
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [chat.length, pending]);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const send = () => { const m = msg.trim(); if (!m) return; setSent(m); run(() => refineRoadmap(roadmapId, m), () => { setMsg(""); setSent(null); }); };
  return (
    <section className="card flex flex-col gap-3 rchat">
      <StepHead n="↻" ai title={t("rm2.chat")} sub={t("rm2.chatHint")} />
      {(chat.length > 0 || pending) && (
        <div className="rchat-list">
          {chat.map((m, i) => <div key={i} className={`rmsg ${m.role}`}><div>{m.text}</div><span className="muted">{new Date(m.at).toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>)}
          {pending && sent && <div className="rmsg teacher"><div>{sent}</div></div>}
          {pending && sent && <div className="rmsg ai"><div className="flex items-center gap-2"><span className="dict-spin" />{t("rm2.updating")}</div></div>}
          <div ref={end} />
        </div>
      )}
      <div className="dictbox">
        <textarea className="textarea" rows={3} value={msg} placeholder={t("rm2.chatPh")} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} disabled={pending} />
        <Dictate round onText={(x) => setMsg((m) => add(m, x))} />
      </div>
      <button className="btn primary sm self-start" disabled={pending || !msg.trim()} onClick={send}><Icon name="send" size="sm" />{t("rm2.send")}</button>
      {error && <div className="alert">{error}</div>}
      {versions.length > 0 && (
        <details className="tpack-sec">
          <summary><span className="grow">{t("rm2.versions")}</span><span className="pill grey">{versions.length}</span><Icon name="chevd" size="sm" /></summary>
          <ul className="rvers">
            {versions.map((v, i) => (
              <li key={i}><span className="grow small">{new Date(v.at).toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{v.note && !/^before /.test(v.note) ? ` · ${t("rm2.beforeMsg", { m: v.note })}` : v.note === "before rebuild" ? ` · ${t("rm2.beforeRebuild")}` : v.note === "before restore" ? ` · ${t("rm2.beforeRestore")}` : ""}</span>
                <button className="btn plain sm" disabled={pending} onClick={() => confirm(t("rm2.restoreQ")) && run(() => restoreVersion(roadmapId, i))}>{t("rm2.restore")}</button></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
