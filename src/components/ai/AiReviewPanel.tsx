"use client";
// Проверка работы ИИ у учителя: текст ученика с подсветкой, исправленная версия, список правок и комментарий — всё редактируется.
// Режим сравнения: одна работа — две модели рядом, учитель берёт вариант. Ученик видит итог только после «ОК, показать ученику».
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { aiReviewChoose, aiReviewLoad, aiReviewRun, aiReviewSave, type ReviewDTO } from "@/lib/ai/review";
import { applyEdits, CATEGORIES, EXAMS, SEVERITIES, type CheckResult, type Edit, type Exam } from "@/lib/ai/check-core";

type TT = ReturnType<typeof useT>["t"];
export type AiPick = { id: string; final: CheckResult } | null;

// ───────── Текст с подсветкой ─────────

/** Куски текста: обычные и правки (по позициям). */
function segments(text: string, edits: Edit[]) {
  const out: { s: number; e: number; edit?: Edit; n?: number }[] = [];
  let last = 0;
  [...edits].sort((a, b) => a.start - b.start).forEach((ed, i) => {
    if (ed.start > last) out.push({ s: last, e: ed.start });
    out.push({ s: ed.start, e: ed.end, edit: ed, n: i + 1 });
    last = ed.end;
  });
  if (last < text.length) out.push({ s: last, e: text.length });
  return out;
}

export function MarkedText({ text, edits, sel, onPick, onSelect }: { text: string; edits: Edit[]; sel?: number | null; onPick?: (id: number) => void; onSelect?: (a: number, b: number, x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const up = () => {
    if (!onSelect) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || !ref.current) return;
    const off = (node: Node | null, o: number) => {
      const el = (node?.nodeType === 3 ? node.parentElement : (node as Element | null))?.closest("[data-o]") as HTMLElement | null;
      return el && ref.current!.contains(el) ? Number(el.dataset.o) + (node?.nodeType === 3 ? o : 0) : -1;
    };
    let a = off(s.anchorNode, s.anchorOffset), b = off(s.focusNode, s.focusOffset);
    if (a < 0 || b < 0) return;
    if (a > b) [a, b] = [b, a];
    // без пробелов по краям
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b <= a) return;
    const r = s.getRangeAt(0).getBoundingClientRect(), box = ref.current.getBoundingClientRect();
    onSelect(a, b, r.left - box.left + r.width / 2, r.bottom - box.top);
  };
  return (
    <div ref={ref} className="aitext" onMouseUp={up}>
      {segments(text, edits).map((g) => g.edit ? (
        <mark key={g.s} data-o={g.s} className={`aim ${g.edit.type} sev-${g.edit.severity} ${g.edit.by === "teacher" ? "byt" : ""} ${sel === g.edit.id ? "on" : ""}`} title={g.edit.explanation} onClick={() => onPick?.(g.edit!.id)}>
          {text.slice(g.s, g.e)}<sup>{g.n}</sup>
        </mark>
      ) : <span key={g.s} data-o={g.s}>{text.slice(g.s, g.e)}</span>)}
    </div>
  );
}

export function CorrectedText({ text, edits }: { text: string; edits: Edit[] }) {
  return (
    <div className="aitext">
      {segments(text, edits).map((g) => g.edit ? (g.edit.corrected ? <b key={g.s} className={`aiins ${g.edit.type}`} title={`${g.edit.original} → ${g.edit.corrected}`}>{g.edit.corrected}</b> : <del key={g.s} className="aidel">{text.slice(g.s, g.e)}</del>) : <span key={g.s}>{text.slice(g.s, g.e)}</span>)}
    </div>
  );
}

const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

// ───────── Только просмотр (сравнение, ученик) ─────────

function ReadOnly({ text, r, t }: { text: string; r: CheckResult; t: TT }) {
  return (
    <>
      <MarkedText text={text} edits={r.edits} />
      <ol className="airows ro">
        {r.edits.map((e) => <li key={e.id} className={e.type}><span><del>{e.original}</del> → <b>{e.corrected || "—"}</b></span><span className="small muted">{t(`air.cat.${e.category}`)} · {e.explanation}</span></li>)}
      </ol>
      {r.summary.comment_to_student && <div className="aicomment">{r.summary.comment_to_student}</div>}
    </>
  );
}

// ───────── Панель учителя ─────────

export function AiReviewPanel({ lessonId, taskId, answered, onPick }: { lessonId: string; taskId: string; answered: boolean; onPick: (p: AiPick) => void }) {
  const { t } = useT();
  const [reviews, setReviews] = useState<ReviewDTO[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [work, setWork] = useState<CheckResult | null>(null);
  const [exam, setExam] = useState<Exam>("none");
  const [crit, setCrit] = useState({ oge: false, ege: false });
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"check" | "compare" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [pick, setPickSel] = useState<{ a: number; b: number; x: number; y: number } | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [comparing, setComparing] = useState(false);
  const cur = reviews.find((r) => r.id === active) ?? null;

  const adopt = useCallback((list: ReviewDTO[], compare = false) => {
    setReviews(list);
    const a = list.find((r) => r.chosen) ?? list[0];
    setActive(a?.id ?? null);
    setWork(a ? a.final ?? a.draft : null);
    setComparing(compare && list.length > 1);
    setSel(null);
  }, []);

  useEffect(() => {
    aiReviewLoad(lessonId, taskId).then((r) => {
      if (!r.ok) return;
      setExam(r.exam); setCrit(r.criteria); setModels(r.models);
      adopt(r.reviews, r.reviews.length > 1 && r.reviews.every((x) => x.status === "draft" && !x.final));
    }).catch(() => null);
  }, [lessonId, taskId, adopt]);

  // наверх (ReviewBox): что уйдёт ученику по «ОК»
  useEffect(() => { onPick(cur && work && !comparing ? { id: cur.id, final: work } : null); }, [cur, work, comparing, onPick]);

  // правки учителя сохраняются сами
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (w: CheckResult) => {
    const next = { ...w, corrected_text: cur ? applyEdits(cur.text, w.edits) : w.corrected_text };
    setWork(next); setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (cur) aiReviewSave(cur.id, next).then(() => setSaved("saved")).catch(() => setSaved("idle")); }, 1200);
  };

  const run = async (compare: boolean) => {
    setBusy(compare ? "compare" : "check"); setErr(null);
    const r = await aiReviewRun(lessonId, taskId, { exam, compare }).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    adopt(r.reviews, compare);
  };

  const choose = async (id: string) => {
    await aiReviewChoose(id).catch(() => null);
    const r = reviews.find((x) => x.id === id)!;
    setReviews(reviews.map((x) => ({ ...x, chosen: x.id === id })));
    setActive(id); setWork(r.final ?? r.draft); setComparing(false);
  };

  const setEdit = (id: number, patch: Partial<Edit>) => work && change({ ...work, edits: work.edits.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const delEdit = (id: number) => work && change({ ...work, edits: work.edits.filter((e) => e.id !== id) });
  const addEdit = () => {
    if (!work || !cur || !pick) return;
    if (work.edits.some((e) => pick.a < e.end && pick.b > e.start)) { setErr(t("air.overlap")); setPickSel(null); return; }
    const id = Math.max(0, ...work.edits.map((e) => e.id)) + 1;
    const original = cur.text.slice(pick.a, pick.b);
    const ne: Edit = { id, type: "error", original, start: pick.a, end: pick.b, corrected: original, category: "grammar", severity: "medium", explanation: "", by: "teacher" };
    change({ ...work, edits: [...work.edits, ne].sort((a, b) => a.start - b.start) });
    setSel(id); setPickSel(null); window.getSelection()?.removeAllRanges();
    setTimeout(() => document.getElementById(`aie-${taskId}-${id}`)?.focus(), 50);
  };
  const sm = work?.summary;
  const setSum = (k: keyof CheckResult["summary"], v: string | string[]) => work && change({ ...work, summary: { ...work.summary, [k]: v } });
  const order = useMemo(() => (work ? [...work.edits].sort((a, b) => a.start - b.start) : []), [work]);

  return (
    <div className="aireview">
      <div className="aireview-bar">
        <span className="tk-aiico"><Icon name="spark" size="sm" /></span>
        <b className="grow">{t("air.title")}</b>
        <label className="small muted" htmlFor={`exam-${taskId}`}>{t("air.exam")}</label>
        <select id={`exam-${taskId}`} className="select sm" value={exam} onChange={(e) => setExam(e.target.value as Exam)}>
          {EXAMS.map((x) => <option key={x} value={x}>{t(`air.exam.${x}`)}{(x === "oge" && !crit.oge) || (x === "ege" && !crit.ege) ? ` — ${t("air.noCrit")}` : ""}</option>)}
        </select>
        <button type="button" className="btn tinted sm" disabled={!!busy || !answered} onClick={() => run(false)}><Icon name="spark" size="sm" />{busy === "check" ? t("air.checking") : reviews.length ? t("ai.recheck") : t("ai.check")}</button>
        {models.length > 1 && <button type="button" className="btn secondary sm" disabled={!!busy || !answered} onClick={() => run(true)} title={models.join(" + ")}>{busy === "compare" ? t("air.checking") : t("air.compare")}</button>}
      </div>
      {busy && <p className="small muted m-0 mt-2">{t("air.wait")}</p>}
      {err && <div className="alert mt-2">{err}</div>}
      {(exam === "oge" && !crit.oge) || (exam === "ege" && !crit.ege) ? <p className="small muted m-0 mt-2">{t("air.critHint")} <a className="alink" href="/teacher/profile#exam-criteria">{t("air.critGo")}</a></p> : null}

      {/* сравнение: две модели рядом */}
      {comparing && (
        <div className="aicompare mt-3">
          {reviews.map((r) => (
            <div key={r.id} className="aicol">
              <div className="aicol-h"><b>{r.label}</b><span className="small muted">{t("air.stat", { n: r.draft.edits.length, s: Math.round(r.meta.ms / 1000) })}</span></div>
              <ReadOnly text={r.text} r={r.draft} t={t} />
              <button type="button" className="btn primary sm mt-3" onClick={() => choose(r.id)}>{t("air.take")}</button>
            </div>
          ))}
        </div>
      )}

      {cur && work && !comparing && sm && (
        <>
          <div className="aimeta small muted">
            <span className="pill violet">{cur.label}</span>
            {cur.meta.selfCheck && <span>✓ {t("air.selfCheck")}</span>}
            {cur.meta.dropped > 0 && <span>{t("air.dropped", { n: cur.meta.dropped })}</span>}
            {cur.meta.fallbackFrom && <span className="text-warn">{t("air.fallback")}</span>}
            {reviews.length > 1 && <button type="button" className="alink" onClick={() => setComparing(true)}>{t("air.backCompare")}</button>}
            <span className="grow" />
            <span>{saved === "saving" ? t("air.saving") : saved === "saved" ? t("air.saved") : cur.status === "approved" ? t("air.approved") : ""}</span>
          </div>
          <div className="aicols">
            <div className="aicol rel">
              <div className="aicol-h"><b>{t("air.student")}</b><span className="small muted">{t("air.selectHint")}</span></div>
              <MarkedText text={cur.text} edits={work.edits} sel={sel} onPick={(id) => { setSel(id); document.getElementById(`aie-${taskId}-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }} onSelect={(a, b, x, y) => setPickSel({ a, b, x, y })} />
              {pick && <button type="button" className="btn primary sm aiaddbtn" style={{ left: pick.x, top: pick.y + 34 }} onMouseDown={(e) => e.preventDefault()} onClick={addEdit}>+ {t("air.addEdit")}</button>}
            </div>
            <div className="aicol">
              <div className="aicol-h"><b>{t("air.corrected")}</b></div>
              <CorrectedText text={cur.text} edits={work.edits} />
            </div>
          </div>

          <h4 className="mb-2 mt-4">{t("air.edits", { n: order.length })}</h4>
          {order.length === 0 && <p className="small muted m-0">{t("air.noEdits")}</p>}
          <ol className="airows">
            {order.map((e, i) => (
              <li key={e.id} className={`${e.type} ${sel === e.id ? "on" : ""}`} onFocus={() => setSel(e.id)}>
                <span className="ainum">{i + 1}</span>
                <div className="grow min-w-0">
                  <div className="airow-top">
                    <del>{e.original}</del><span className="muted">→</span>
                    <input id={`aie-${taskId}-${e.id}`} className="input sm grow" value={e.corrected} onChange={(x) => setEdit(e.id, { corrected: x.target.value })} aria-label={t("air.correctedOne")} />
                  </div>
                  <div className="airow-meta">
                    <div className="seg xs"><button type="button" aria-pressed={e.type === "error"} onClick={() => setEdit(e.id, { type: "error" })}>{t("air.error")}</button><button type="button" aria-pressed={e.type === "improvement"} onClick={() => setEdit(e.id, { type: "improvement" })}>{t("air.improvement")}</button></div>
                    <select className="select xs" value={e.category} onChange={(x) => setEdit(e.id, { category: x.target.value as Edit["category"] })} aria-label={t("air.category")}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`air.cat.${c}`)}</option>)}</select>
                    <select className="select xs" value={e.severity} onChange={(x) => setEdit(e.id, { severity: x.target.value as Edit["severity"] })} aria-label={t("air.severity")}>{SEVERITIES.map((c) => <option key={c} value={c}>{t(`air.sev.${c}`)}</option>)}</select>
                    {e.by === "teacher" && <span className="pill blue">{t("air.mine")}</span>}
                  </div>
                  <textarea className="textarea sm" rows={1} value={e.explanation} placeholder={t("air.explPh")} onChange={(x) => setEdit(e.id, { explanation: x.target.value })} aria-label={t("air.expl")} />
                </div>
                <button type="button" className="iconbtn" aria-label={t("common.delete")} title={t("common.delete")} onClick={() => delEdit(e.id)}><Icon name="close" size="sm" /></button>
              </li>
            ))}
          </ol>

          <div className="aisum">
            <div className="field"><label htmlFor={`cs-${taskId}`}>{t("air.comment")}</label><textarea id={`cs-${taskId}`} className="textarea" rows={3} value={sm.comment_to_student} onChange={(e) => setSum("comment_to_student", e.target.value)} /></div>
            <div className="aisum-grid">
              <div className="field"><label htmlFor={`st-${taskId}`}>{t("air.strengths")}</label><textarea id={`st-${taskId}`} className="textarea sm" rows={3} value={sm.strengths.join("\n")} onChange={(e) => setSum("strengths", lines(e.target.value))} /></div>
              <div className="field"><label htmlFor={`mi-${taskId}`}>{t("air.issues")}</label><textarea id={`mi-${taskId}`} className="textarea sm" rows={3} value={sm.main_issues.join("\n")} onChange={(e) => setSum("main_issues", lines(e.target.value))} /></div>
              <div className="field"><label htmlFor={`ns-${taskId}`}>{t("air.next")}</label><textarea id={`ns-${taskId}`} className="textarea sm" rows={3} value={sm.next_steps.join("\n")} onChange={(e) => setSum("next_steps", lines(e.target.value))} /></div>
            </div>
            <div className="aisum-grid two">
              <div className="field"><label htmlFor={`ta-${taskId}`}>{t("air.task")}</label><input id={`ta-${taskId}`} className="input" value={sm.task_achievement} onChange={(e) => setSum("task_achievement", e.target.value)} /></div>
              <div className="field"><label htmlFor={`el-${taskId}`}>{t("air.level")}</label><input id={`el-${taskId}`} className="input" value={sm.estimated_level} onChange={(e) => setSum("estimated_level", e.target.value)} /></div>
            </div>
            {work.scores && (
              <div className="aiscores">
                <b className="small">{t("air.scores")} · {t(`air.exam.${((EXAMS as readonly string[]).includes(work.scores.exam) ? work.scores.exam : cur.exam) as Exam}`)}</b>
                {work.scores.criteria.map((c, i) => (
                  <div key={i} className="aiscore">
                    <span className="grow small">{c.name}</span>
                    <input className="input xs" value={c.score} onChange={(e) => change({ ...work, scores: { ...work.scores!, criteria: work.scores!.criteria.map((x, j) => (j === i ? { ...x, score: e.target.value } : x)) } })} aria-label={c.name} />
                    <input className="input xs grow" value={c.justification} onChange={(e) => change({ ...work, scores: { ...work.scores!, criteria: work.scores!.criteria.map((x, j) => (j === i ? { ...x, justification: e.target.value } : x)) } })} aria-label={t("air.why")} />
                  </div>
                ))}
                {work.scores.overall != null && <div className="aiscore"><b className="grow small">{t("air.overall")}</b><input className="input xs" value={work.scores.overall ?? ""} onChange={(e) => change({ ...work, scores: { ...work.scores!, overall: e.target.value } })} aria-label={t("air.overall")} /></div>}
                {work.scores.note && <p className="small muted m-0 mt-1">{work.scores.note}</p>}
              </div>
            )}
          </div>
          <p className="small muted m-0 mt-2">{t("air.okHint")}</p>
        </>
      )}
    </div>
  );
}

// ───────── Ученик (после «ОК») ─────────

export type StudentCheckData = CheckResult & { source?: string };

export function StudentCheck({ check }: { check: StudentCheckData }) {
  const { t } = useT();
  const [view, setView] = useState<"mine" | "fixed">("mine");
  const text = check.source ?? "";
  const order = [...check.edits].sort((a, b) => a.start - b.start);
  return (
    <div className="aireview student">
      <div className="aireview-bar"><span className="tk-aiico"><Icon name="check" size="sm" /></span><b className="grow">{t("air.studentTitle")}</b>
        {text && <div className="seg xs"><button type="button" aria-pressed={view === "mine"} onClick={() => setView("mine")}>{t("air.myText")}</button><button type="button" aria-pressed={view === "fixed"} onClick={() => setView("fixed")}>{t("air.corrected")}</button></div>}
      </div>
      {check.summary.comment_to_student && <div className="aicomment mt-3">{check.summary.comment_to_student}</div>}
      {text && (view === "mine" ? <MarkedText text={text} edits={check.edits} /> : <CorrectedText text={text} edits={check.edits} />)}
      {order.length > 0 && (
        <ol className="airows ro">
          {order.map((e) => (
            <li key={e.id} className={e.type}>
              <span>{e.type === "improvement" && <span className="pill blue mr-1">{t("air.better")}</span>}<del>{e.original}</del> → <b>{e.corrected || "—"}</b></span>
              {e.explanation && <span className="small muted">{e.explanation}</span>}
            </li>
          ))}
        </ol>
      )}
      {(check.summary.strengths.length > 0 || check.summary.next_steps.length > 0) && (
        <div className="aisum-grid two mt-3">
          {check.summary.strengths.length > 0 && <div><b className="small">{t("air.strengthsS")}</b><ul className="m-0 mt-1 pl-5 small">{check.summary.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {check.summary.next_steps.length > 0 && <div><b className="small">{t("air.nextS")}</b><ul className="m-0 mt-1 pl-5 small">{check.summary.next_steps.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
        </div>
      )}
      {check.scores && check.scores.criteria.length > 0 && (
        <div className="aiscores mt-3">
          {check.scores.criteria.map((c, i) => <div key={i} className="aiscore"><span className="grow small">{c.name}</span><b>{c.score}</b></div>)}
          {check.scores.overall && <div className="aiscore"><b className="grow small">{t("air.overall")}</b><b>{check.scores.overall}</b></div>}
        </div>
      )}
    </div>
  );
}
