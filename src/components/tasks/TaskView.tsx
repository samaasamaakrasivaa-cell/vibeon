"use client";
// Задание глазами ученика: показ и проверка для всех типов конструктора.
// Используется в превью конструктора («Ученик увидит»), в «Поделиться», а на этапах 5–6 — в уроке и кабинете ученика.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { numbered, type TaskOptions, type TaskType } from "@/lib/tasks/catalog";
import { buildCrossword, dictationGrade, fmtTime, parse, same, series, shuffle, videoEmbed, type Seg } from "@/lib/tasks/parse";
import { Icon } from "../Icon";
import { useSlot, useTaskRole } from "./store";
import { AiTalk } from "../ai/AiTalk";
import { AiCheckView, type AiCheck } from "../ai/AiCheckView";
import { transcribe } from "../ai/audio";
import { fixSpeech } from "@/lib/ai/actions";

export type TaskData = { id: string; type: TaskType; title: string; content: string; options: TaskOptions };
type Mark = "ok" | "bad" | "spell" | undefined;

/** Общая логика проверки: «сразу» (до 3 попыток) или кнопкой «Проверить». */
function useChecker(o: TaskOptions, id: string) {
  const instant = (o.checkMode ?? "button") === "instant";
  const [checked, setChecked] = useSlot(id, "checked", false);
  const [tries, setTries] = useSlot<Record<string, number>>(id, "tries", {});
  const bump = (k: string) => setTries((t) => ({ ...t, [k]: (t[k] ?? 0) + 1 }));
  const reveal = (k: string) => !o.noreveal && (tries[k] ?? 0) >= 3;
  return { instant, checked: instant || checked, setChecked, tries, bump, reveal, reset: () => { setChecked(false); setTries({}); } };
}

function CheckBar({ ck, errors, total, onReset, onCheck }: { ck: ReturnType<typeof useChecker>; errors: number; total: number; onReset: () => void; onCheck?: () => void }) {
  const { t } = useT();
  const role = useTaskRole();
  if (ck.instant) return null; // в режиме «сразу» каждое поле проверяется само
  if (role === "teacher")
    return ck.checked ? <div className="tk-bar"><span className={`small font-semibold ${errors ? "text-bad" : "text-ok"}`}>{errors ? t("tk.right", { n: total - errors, total }) : `✓ ${t("tk.allRight")}`}</span></div> : null;
  return (
    <div className="tk-bar">
      {!ck.checked ? (
        <button type="button" className="btn primary sm" onClick={() => { ck.setChecked(true); onCheck?.(); }}>{t("tk.check")}</button>
      ) : (
        <>
          <span className={`small font-semibold ${errors ? "text-bad" : "text-ok"}`}>
            {errors ? `${t("tk.right", { n: total - errors, total })} · ${t("tk.mistakesHelp")}` : `✓ ${t("tk.allRight")}`}
          </span>
          {errors > 0 && <button type="button" className="btn secondary sm" onClick={() => { onReset(); ck.setChecked(false); }}>{t("tk.resetErrors")}</button>}
        </>
      )}
    </div>
  );
}

const Num = ({ i, o }: { i: number; o: TaskOptions }) => (o.nonum ? null : <span className="tk-n">{i + 1}.</span>);

// ───────── Пропуски / выбор из списка ─────────
function Gaps({ task, kind }: { task: TaskData; kind: "gap" | "dropdown" }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse(task.type, task.content), [task.type, task.content]);
  const drag = kind === "gap" && (task.type === "drag" || o.mode === "drag");
  const ck = useChecker(o, task.id);
  const [val, setVal] = useSlot<Record<string, string>>(task.id, "val", {});
  const [pick, setPick] = useState<string | null>(null);
  if (p.kind !== "gaps") return null;
  const groups = series(p.lines.map((l, i) => ({ l, i })), o.split ? (o.seriesSize ?? 5) : undefined);
  const gapKeys: { k: string; s: Extract<Seg, { t: "gap" }> }[] = [];
  p.lines.forEach((l, li) => l.forEach((s, si) => s.t === "gap" && gapKeys.push({ k: `${li}:${si}`, s })));
  const markOf = (k: string, s: Extract<Seg, { t: "gap" }>): Mark => {
    const v = val[k];
    if (!v || !ck.checked) return undefined;
    return same(v, s.answers) ? "ok" : "bad";
  };
  const errors = gapKeys.filter(({ k, s }) => !same(val[k] ?? "", s.answers)).length;
  const set = (k: string, v: string) => { setVal((x) => ({ ...x, [k]: v })); if (ck.instant && v) ck.bump(k); };

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, gi) => {
        const bank = shuffle(g.flatMap(({ l }) => l.flatMap((s) => (s.t === "gap" ? [s.answers[0]] : []))), task.id + gi);
        const used = new Set(g.flatMap(({ l, i }) => l.map((_, si) => val[`${i}:${si}`]).filter(Boolean)));
        return (
          <div key={gi} className={groups.length > 1 ? "tk-series" : ""}>
            {groups.length > 1 && <div className="small mb-2 font-semibold text-text3">{t("tk.series", { n: gi + 1 })}</div>}
            {drag && (
              <div className="tk-bank">
                {bank.map((w, wi) => (
                  <button key={wi} type="button" className={`tk-chip ${pick === w ? "on" : ""}`} disabled={used.has(w)} onClick={() => setPick(pick === w ? null : w)}
                    draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", w)}>{w}</button>
                ))}
              </div>
            )}
            <ol className="tk-lines">
              {g.map(({ l, i }) => (
                <li key={i}>
                  <Num i={i} o={o} />
                  <span>
                    {l.map((s, si) => {
                      if (s.t === "text") return <Inl key={si} text={s.v} />;
                      const k = `${i}:${si}`;
                      const m = markOf(k, s);
                      const shown = ck.reveal(k) && m === "bad";
                      if (kind === "dropdown")
                        return (
                          <select key={si} data-ans={s.answers.join(" / ")} className={`tk-sel ${m ?? ""}`} value={val[k] ?? ""} onChange={(e) => set(k, e.target.value)} aria-label={`gap ${i + 1}`}>
                            <option value="">…</option>
                            {s.options!.map((x) => <option key={x}>{x}</option>)}
                          </select>
                        );
                      if (drag)
                        return (
                          <button key={si} type="button" data-ans={s.answers.join(" / ")} className={`tk-slot ${m ?? ""} ${val[k] ? "full" : ""}`}
                            onClick={() => { if (pick) { set(k, pick); setPick(null); } else set(k, ""); }}
                            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); set(k, e.dataTransfer.getData("text/plain")); }}>
                            {val[k] || " "}
                          </button>
                        );
                      return (
                        <span key={si} className="tk-gapw" data-ans={s.answers.join(" / ")}>
                          <input className={`tk-gap ${m ?? ""}`} value={val[k] ?? ""} size={Math.max(4, (s.answers[0] ?? "").length + 1)}
                            onChange={(e) => setVal((x) => ({ ...x, [k]: e.target.value }))} onBlur={(e) => ck.instant && e.target.value && ck.bump(k)}
                            aria-label={`gap ${i + 1}`} />
                          {s.hint && <span className="tk-hint">({s.hint})</span>}
                          {shown && <span className="tk-ans">{s.answers[0]}</span>}
                        </span>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      <CheckBar ck={ck} errors={errors} total={gapKeys.length} onReset={() => setVal((v) => Object.fromEntries(Object.entries(v).filter(([k]) => { const g = gapKeys.find((x) => x.k === k); return g && same(v[k], g.s.answers); })))} />
    </div>
  );
}

// ───────── Найди и исправь ошибку (два шага) ─────────
function Errors({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse("errors", task.content), [task.content]);
  const ck = useChecker(o, task.id);
  const [found, setFound] = useSlot<Record<number, boolean>>(task.id, "found", {});
  const [miss, setMiss] = useSlot<Record<string, boolean>>(task.id, "miss", {});
  const [fix, setFix] = useSlot<Record<number, string>>(task.id, "fix", {});
  if (p.kind !== "gaps") return null;
  const errors = p.lines.filter((l, i) => { const g = l.find((s) => s.t === "gap") as Extract<Seg, { t: "gap" }> | undefined; return !g || !found[i] || !same(fix[i] ?? "", g.answers); }).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="hint m-0">{t("tk.errorsHint")}</p>
      <ol className="tk-lines">
        {p.lines.map((l, i) => (
          <li key={i}>
            <Num i={i} o={o} />
            <span>
              {l.map((s, si) => {
                if (s.t === "text")
                  return s.v.split(/(\s+)/).map((w, wi) => (/^\s+$/.test(w) || !w ? w : (
                    <span key={`${si}-${wi}`} className={`tk-word ${miss[`${i}:${si}:${wi}`] ? "bad" : ""}`} onClick={() => !found[i] && setMiss((m) => ({ ...m, [`${i}:${si}:${wi}`]: true }))}>{w}</span>
                  )));
                const wrong = s.options!.find((x) => !s.answers.includes(x)) ?? s.options![0];
                if (!found[i]) return <span key={si} className="tk-word" onClick={() => setFound((f) => ({ ...f, [i]: true }))}>{wrong}</span>;
                const m: Mark = ck.checked && fix[i] ? (same(fix[i], s.answers) ? "ok" : "bad") : undefined;
                return (
                  <span key={si} className="tk-gapw">
                    <s className="text-bad">{wrong}</s>{" "}
                    <input autoFocus className={`tk-gap ${m ?? ""}`} value={fix[i] ?? ""} size={Math.max(4, (s.answers[0] ?? "").length + 1)} onChange={(e) => setFix((x) => ({ ...x, [i]: e.target.value }))} onBlur={(e) => ck.instant && e.target.value && ck.bump(String(i))} aria-label="fix" />
                    {ck.reveal(String(i)) && m === "bad" && <span className="tk-ans">{s.answers[0]}</span>}
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ol>
      <CheckBar ck={ck} errors={errors} total={p.lines.length} onReset={() => { setMiss({}); }} />
    </div>
  );
}

// ───────── Выдели слова в тексте ─────────
// Инструмент работы с текстом: ученик нажимает на слова — они выделяются для него, повторное нажатие снимает. Правильных ответов нет.
// На уроке (MarkCtx): учитель видит выделения ученика, может выделить своё и «Показать ученику» — ученик увидит их другим цветом.
export type MarkLayer = { teacher: boolean; student: string; mine: Record<string, number[]>; shown: string[]; setMine: (taskId: string, ids: number[]) => void; toggleShown: (taskId: string) => void };
export const MarkCtx = createContext<MarkLayer | null>(null);
function MarkWords({ task, content }: { task: TaskData; content?: string }) {
  const { t } = useT();
  const p = useMemo(() => parse("mark", content ?? task.content), [content, task.content]);
  const [sel, setSel] = useSlot<Record<number, boolean>>(task.id, "sel", {});
  const ctx = useContext(MarkCtx);
  const role = useTaskRole();
  const teacher = !!ctx?.teacher && role === "teacher";
  const [view, setView] = useState<"student" | "mine">("student"); // учитель: смотрит выделения ученика или выделяет своё
  if (p.kind !== "mark") return null;
  const mine = new Set(ctx?.mine[task.id] ?? []);
  const shown = !!ctx?.shown.includes(task.id);
  const editMine = teacher && view === "mine";
  const tap = (i: number) => {
    if (editMine) { const n = new Set(mine); if (n.has(i)) n.delete(i); else n.add(i); ctx!.setMine(task.id, [...n]); return; }
    if (teacher) return; // выделения ученика учитель только смотрит
    setSel((x) => ({ ...x, [i]: !x[i] }));
  };
  const cls = (i: number) => {
    const st = !!sel[i], tc = mine.has(i);
    if (editMine) return tc ? "tch" : "";
    if (teacher) return st ? "on" : "";
    return `${st ? "on" : ""} ${shown && tc ? "tch" : ""}`;
  };
  return (
    <div className="flex flex-col gap-3">
      {teacher ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label={t("tk.markView")}>
            <button type="button" aria-pressed={view === "student"} onClick={() => setView("student")}>{t("tk.markStudent", { name: ctx!.student })}</button>
            <button type="button" aria-pressed={view === "mine"} onClick={() => setView("mine")}>{t("tk.markMine")}</button>
          </div>
          {view === "mine" && <button type="button" className={`btn sm ${shown ? "primary" : "secondary"}`} disabled={!mine.size && !shown} onClick={() => ctx!.toggleShown(task.id)}><Icon name={shown ? "eye" : "eyeoff"} size="sm" />{shown ? t("tk.markShown") : t("tk.markShow")}</button>}
        </div>
      ) : <p className="hint m-0">{t("tk.markFree")}{shown && mine.size ? ` ${t("tk.markTeacherOn")}` : ""}</p>}
      <div className={`tk-marktext ${teacher && view === "student" ? "ro" : ""}`}>
        {p.lines.map((line, li) => (
          <p key={li} className="m-0">
            {line.length === 0 ? "\u00a0" : line.map((x, k) => x.t === "x" ? <span key={k}>{x.v}</span> : (
              <span key={k} role="button" tabIndex={0} aria-pressed={cls(x.i).includes("on") || cls(x.i).includes("tch")} className={`tk-mk ${cls(x.i)}`}
                onClick={() => tap(x.i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(x.i); } }}>{x.v}</span>
            ))}
          </p>
        ))}
      </div>
      {!teacher && Object.values(sel).some(Boolean) && <button type="button" className="btn plain sm self-start" onClick={() => setSel({})}>{t("tk.markClear")}</button>}
    </div>
  );
}

// ───────── Тест ─────────
function Test({ task }: { task: TaskData }) {
  const o = task.options;
  const p = useMemo(() => parse("test", task.content), [task.content]);
  const ck = useChecker(o, task.id);
  const [ans, setAns] = useSlot<Record<number, number[]>>(task.id, "ans", {});
  if (p.kind !== "test") return null;
  const ok = (qi: number) => { const a = [...(ans[qi] ?? [])].sort().join(); return a === [...p.qs[qi].correct].sort().join(); };
  const errors = p.qs.filter((_, i) => !ok(i)).length;
  return (
    <div className="flex flex-col gap-4">
      {p.qs.map((q, qi) => {
        const multi = q.correct.length > 1 || o.multi;
        return (
          <div key={qi}>
            <div className="mb-2 font-semibold"><Num i={qi} o={o} /> <Inl text={q.q} /></div>
            <div className="flex flex-col gap-1.5">
              {q.options.map((op, oi) => {
                const sel = (ans[qi] ?? []).includes(oi);
                const m: Mark = ck.checked && sel ? (q.correct.includes(oi) ? "ok" : "bad") : undefined;
                return (
                  <label key={oi} data-right={q.correct.includes(oi) ? "1" : undefined} className={`tk-opt ${sel ? "sel" : ""} ${m ?? ""}`}>
                    <input type={multi ? "checkbox" : "radio"} name={`${task.id}-${qi}`} checked={sel}
                      onChange={() => { setAns((a) => ({ ...a, [qi]: multi ? (sel ? (a[qi] ?? []).filter((x) => x !== oi) : [...(a[qi] ?? []), oi]) : [oi] })); if (ck.instant) ck.bump(String(qi)); }} />
                    <span>{String.fromCharCode(65 + oi)}. {op}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      <CheckBar ck={ck} errors={errors} total={p.qs.length} onReset={() => setAns((a) => Object.fromEntries(Object.entries(a).filter(([k]) => ok(+k))))} />
    </div>
  );
}

// ───────── Верно / неверно ─────────
function TF({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse("tf", task.content), [task.content]);
  const ck = useChecker(o, task.id);
  const [ans, setAns] = useSlot<Record<number, string>>(task.id, "ans", {});
  if (p.kind !== "tf") return null;
  const opts: ["T" | "F" | "NS", string][] = [["T", t("tk.true")], ["F", t("tk.false")], ...(p.ns || o.ns ? [["NS", t("tk.ns")] as ["NS", string]] : [])];
  const errors = p.items.filter((it, i) => ans[i] !== it.a).length;
  return (
    <div className="flex flex-col gap-3">
      {p.items.map((it, i) => (
        <div key={i} className="tk-tf">
          <span className="grow"><Num i={i} o={o} /> <Inl text={it.s} /></span>
          <div className="seg xs">
            {opts.map(([v, l]) => {
              const sel = ans[i] === v;
              const m: Mark = ck.checked && sel ? (v === it.a ? "ok" : "bad") : undefined;
              return <button key={v} type="button" aria-pressed={sel} className={m ? `tk-${m}` : ""} onClick={() => { setAns((a) => ({ ...a, [i]: v })); if (ck.instant) ck.bump(String(i)); }}>{l}</button>;
            })}
          </div>
        </div>
      ))}
      <CheckBar ck={ck} errors={errors} total={p.items.length} onReset={() => setAns((a) => Object.fromEntries(Object.entries(a).filter(([k, v]) => p.items[+k].a === v)))} />
    </div>
  );
}

// ───────── Соедини пары ─────────
const LINK_COLORS = ["#0A84FF", "#A55CF5", "#FF9500", "#34C759", "#FF2D55", "#5AC8FA", "#FFCC00", "#AF52DE"];
function Pairs({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse("pairs", task.content), [task.content]);
  const ck = useChecker(o, task.id);
  const [link, setLink] = useSlot<Record<number, number>>(task.id, "link", {}); // левый → индекс правого
  const [sel, setSel] = useState<number | null>(null);
  if (p.kind !== "pairs") return null;
  const right = shuffle(p.pairs.map((_, i) => i), task.id);
  const usedR = new Map(Object.entries(link).map(([l, r]) => [r, +l]));
  const okPair = (l: number) => link[l] === l;
  const errors = p.pairs.filter((_, i) => !okPair(i)).length;
  const done = ck.checked ? p.pairs.map((_, i) => i).filter(okPair) : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="tk-pairs">
        <div className="flex flex-col gap-2">
          {p.pairs.map((pr, i) => done.includes(i) ? null : (
            <button key={i} type="button" className={`tk-card ${sel === i ? "on" : ""} ${ck.checked && link[i] !== undefined && !okPair(i) ? "bad" : ""}`}
              style={link[i] !== undefined ? { boxShadow: `inset 4px 0 0 ${LINK_COLORS[i % 8]}` } : undefined}
              onClick={() => setSel(sel === i ? null : i)}>{pr[0]}</button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {right.map((ri) => done.includes(ri) ? null : (
            <button key={ri} type="button" className="tk-card"
              style={usedR.has(ri) ? { boxShadow: `inset 4px 0 0 ${LINK_COLORS[usedR.get(ri)! % 8]}` } : undefined}
              onClick={() => {
                if (sel === null) { if (usedR.has(ri)) setLink((x) => { const y = { ...x }; delete y[usedR.get(ri)!]; return y; }); return; }
                setLink((x) => { const y = Object.fromEntries(Object.entries(x).filter(([, r]) => r !== ri)); y[sel] = ri; return y; });
                if (ck.instant) ck.bump(String(sel));
                setSel(null);
              }}>{p.pairs[ri][1]}</button>
          ))}
        </div>
      </div>
      {done.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {done.map((i) => <div key={i} className="tk-done">✓ {p.pairs[i][0]} — {p.pairs[i][1]}</div>)}
        </div>
      )}
      {!ck.checked && <p className="hint m-0">{t("tk.pairsHint")}</p>}
      <CheckBar ck={ck} errors={errors} total={p.pairs.length} onReset={() => setLink((x) => Object.fromEntries(Object.entries(x).filter(([l, r]) => +l === r)))} />
    </div>
  );
}

// ───────── Распредели по колонкам / слово к картинке ─────────
function Sort({ task, pictures }: { task: TaskData; pictures?: boolean }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse(task.type, task.content), [task.type, task.content]);
  const ck = useChecker(o, task.id);
  const [place, setPlace] = useSlot<Record<string, number>>(task.id, "place", {});
  const [pick, setPick] = useState<string | null>(null);
  const buckets: { name: string; words: string[]; pic?: string }[] = p.kind === "columns" ? p.cols.map((c) => ({ name: c.name, words: c.words })) : p.kind === "words" ? p.items.map((x, i) => ({ name: x.word, words: [x.word], pic: o.pics?.[i] })) : [];
  const all = shuffle(buckets.flatMap((b) => b.words), task.id);
  const truth = (w: string) => buckets.findIndex((b) => b.words.includes(w));
  const errors = all.filter((w) => place[w] !== truth(w)).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="tk-bank">
        {all.filter((w) => place[w] === undefined).map((w) => (
          <button key={w} type="button" className={`tk-chip ${pick === w ? "on" : ""}`} onClick={() => setPick(pick === w ? null : w)}
            draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", w)}>{w}</button>
        ))}
        {all.every((w) => place[w] !== undefined) && <span className="hint">{t("tk.allPlaced")}</span>}
      </div>
      <div className={pictures ? "tk-pics" : "tk-cols"}>
        {buckets.map((b, bi) => {
          const here = all.filter((w) => place[w] === bi);
          const drop = (w: string) => { setPlace((x) => ({ ...x, [w]: bi })); setPick(null); if (ck.instant) ck.bump(w); };
          return (
            <div key={bi} className="tk-col" onClick={() => pick && drop(pick)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(e.dataTransfer.getData("text/plain")); }}>
              {pictures ? (b.pic ? <img src={b.pic} alt="" className="tk-pic" /> : <div className="tk-pic empty"><Icon name="image" /></div>) : <div className="tk-colh">{b.name}</div>}
              <div className="flex min-h-[38px] flex-wrap gap-1.5">
                {here.map((w) => (
                  <button key={w} type="button" className={`tk-chip ${ck.checked ? (truth(w) === bi ? "ok" : "bad") : ""}`} onClick={(e) => { e.stopPropagation(); setPlace((x) => { const y = { ...x }; delete y[w]; return y; }); }}>{w}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <CheckBar ck={ck} errors={errors} total={all.length} onReset={() => setPlace((x) => Object.fromEntries(Object.entries(x).filter(([w, b]) => truth(w) === b)))} />
    </div>
  );
}

// ───────── Собери предложение / слово из букв ─────────
function Build({ task, letters }: { task: TaskData; letters?: boolean }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse(task.type, task.content), [task.type, task.content]);
  const ck = useChecker(o, task.id);
  const items = p.kind === "sentences" ? p.items.map((toks) => ({ toks, hint: "" })) : p.kind === "words" ? p.items.map((x) => ({ toks: x.word.split(""), hint: x.hint })) : [];
  const [built, setBuilt] = useSlot<Record<number, number[]>>(task.id, "built", {});
  const [left, setLeft] = useState(o.limitSec ?? 0);
  useEffect(() => {
    if (!letters || !o.limitSec || left <= 0) return;
    const id = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(id);
  }, [letters, o.limitSec, left]);
  const answer = (i: number) => (built[i] ?? []).map((k) => items[i].toks[k]).join(letters ? "" : " ");
  const right = (i: number) => (letters ? answer(i).toLowerCase() === items[i].toks.join("").toLowerCase() : same(answer(i), [items[i].toks.join(" ")]));
  const errors = items.filter((_, i) => !right(i)).length;
  return (
    <div className="flex flex-col gap-4">
      {letters && o.limitSec ? <div className={`pill ${left > 0 ? "blue" : "red"} self-start`}><Icon name="clock" size="sm" />{left > 0 ? `0:${String(left).padStart(2, "0")}` : t("tk.timeUp")}</div> : null}
      {items.map((it, i) => {
        const order = shuffle(it.toks.map((_, k) => k), task.id + i);
        const b = built[i] ?? [];
        const m: Mark = ck.checked && b.length ? (right(i) ? "ok" : "bad") : undefined;
        return (
          <div key={i} className="flex gap-2">
            <Num i={i} o={o} />
            <div className="grow flex flex-col gap-2">
              {it.hint && <span className="small muted">{it.hint}</span>}
              <div className={`tk-build ${m ?? ""}`}>
                {b.length === 0 ? <span className="hint">{t("tk.tapWords")}</span> : b.map((k, bi) => (
                  <button key={bi} type="button" className="tk-chip" onClick={() => setBuilt((x) => ({ ...x, [i]: b.filter((_, j) => j !== bi) }))}>{it.toks[k]}</button>
                ))}
              </div>
              <div className="tk-bank">
                {order.map((k) => (
                  <button key={k} type="button" className="tk-chip" disabled={b.includes(k) || (letters && !!o.limitSec && left <= 0)}
                    onClick={() => { const nb = [...b, k]; setBuilt((x) => ({ ...x, [i]: nb })); if (ck.instant && nb.length === it.toks.length) ck.bump(String(i)); }}>{it.toks[k]}</button>
                ))}
              </div>
              {ck.reveal(String(i)) && m === "bad" && <span className="tk-ans self-start">{it.toks.join(letters ? "" : " ")}</span>}
            </div>
          </div>
        );
      })}
      <CheckBar ck={ck} errors={errors} total={items.length} onReset={() => setBuilt((x) => Object.fromEntries(Object.entries(x).filter(([k]) => right(+k))))} />
    </div>
  );
}

// ───────── Текст по порядку ─────────
// Закреплённые строки (options.fixed) стоят на своих местах и не перемешиваются; ученик двигает только остальные.
// В ответе хранится порядок свободных строк; старые ответы (все строки) приводятся к нему.
function Order({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse("textorder", task.content), [task.content]);
  const items = p.kind === "lines" ? p.items : [];
  const fixed = new Set((o.fixed ?? []).filter((i) => i < items.length));
  const free = items.map((_, i) => i).filter((i) => !fixed.has(i));
  const [saved, setOrd] = useSlot<number[]>(task.id, "ord", () => shuffle(free, task.id));
  const freeOrd = [...saved.filter((v, k) => free.includes(v) && saved.indexOf(v) === k), ...free.filter((v) => !saved.includes(v))];
  let k = 0;
  const ord = items.map((_, i) => (fixed.has(i) ? i : freeOrd[k++]));
  const ck = useChecker(o, task.id);
  const [drag, setDrag] = useState<number | null>(null);
  // позиции — места в списке; двигаем только между свободными местами
  const move = (from: number, to: number) => {
    const a = free.indexOf(from), b = free.indexOf(to);
    if (a < 0 || b < 0 || a === b) return;
    const y = [...freeOrd]; const [v] = y.splice(a, 1); y.splice(b, 0, v); setOrd(y);
  };
  const near = (i: number, d: -1 | 1) => { const fi = free.indexOf(i) + d; return fi >= 0 && fi < free.length ? free[fi] : null; };
  const errors = free.filter((i) => ord[i] !== i).length;
  return (
    <div className="flex flex-col gap-2">
      {ord.map((v, i) => fixed.has(i) ? (
        <div key={`f${v}`} className="tk-row pinned" title={t("tk.fixedRow")}>
          <Icon name="pin" size="sm" className="text-text3" />
          <span className="grow">{items[v]}</span>
          <span className="small text-text3">{t("tk.fixedRow")}</span>
        </div>
      ) : (
        <div key={v} className={`tk-row ${ck.checked ? (v === i ? "ok" : "bad") : ""}`} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}>
          <Icon name="move" size="sm" className="text-text3" />
          <span className="grow">{items[v]}</span>
          <button type="button" className="iconbtn" aria-label="up" disabled={near(i, -1) === null} onClick={() => move(i, near(i, -1)!)}>↑</button>
          <button type="button" className="iconbtn" aria-label="down" disabled={near(i, 1) === null} onClick={() => move(i, near(i, 1)!)}>↓</button>
        </div>
      ))}
      <p className="hint m-0">{t("tk.orderHint")}</p>
      <CheckBar ck={ck} errors={errors} total={free.length} onReset={() => {}} />
    </div>
  );
}

// ───────── Перефразирование / перевод ─────────
function Arrow({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse(task.type, task.content), [task.type, task.content]);
  const ck = useChecker(o, task.id);
  const [val, setVal] = useSlot<Record<number, string>>(task.id, "val", {});
  if (p.kind !== "pairsArrow") return null;
  const errors = p.items.filter((it, i) => it.answers.length && !same(val[i] ?? "", it.answers)).length;
  return (
    <div className="flex flex-col gap-4">
      {p.items.map((it, i) => {
        const m: Mark = ck.checked && val[i] && it.answers.length ? (same(val[i], it.answers) ? "ok" : "bad") : undefined;
        return (
          <div key={i}>
            <div className="mb-1.5"><Num i={i} o={o} /> {it.q} {it.key && <b className="tk-key">{it.key}</b>}</div>
            <input className={`input tk-line ${m ?? ""}`} value={val[i] ?? ""} onChange={(e) => setVal((x) => ({ ...x, [i]: e.target.value }))} onBlur={(e) => ck.instant && e.target.value && ck.bump(String(i))} aria-label={`answer ${i + 1}`} />
            {m === "bad" && <span className="small text-text2">{t("tk.teacherWillSee")}</span>}
            {ck.reveal(String(i)) && m === "bad" && <span className="tk-ans">{it.answers[0]}</span>}
          </div>
        );
      })}
      <CheckBar ck={ck} errors={errors} total={p.items.filter((x) => x.answers.length).length} onReset={() => setVal((x) => Object.fromEntries(Object.entries(x).filter(([k, v]) => same(v, p.items[+k].answers))))} />
    </div>
  );
}

// ───────── Диктант ─────────
const speak = (text: string) => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-GB"; u.rate = 0.9;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
};
function Dictation({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse("dictation", task.content), [task.content]);
  const ck = useChecker(o, task.id);
  const [val, setVal] = useSlot<Record<number, string>>(task.id, "val", {});
  if (p.kind !== "lines") return null;
  const grade = (i: number) => dictationGrade(val[i] ?? "", p.items[i]);
  const errors = p.items.filter((_, i) => grade(i) !== "exact").length;
  return (
    <div className="flex flex-col gap-3">
      {p.items.map((s, i) => {
        const g = ck.checked && val[i] ? grade(i) : undefined;
        return (
          <div key={i} className="flex items-center gap-2">
            <Num i={i} o={o} />
            <button type="button" className="iconbtn" style={{ background: "var(--accent-bg)", color: "var(--accent)" }} onClick={() => speak(s)} aria-label={t("tk.listen")}><Icon name="sound" size="sm" /></button>
            <div className="grow">
              <input className={`input tk-line ${g === "exact" ? "ok" : g === "spelling" ? "spell" : g === "wrong" ? "bad" : ""}`} value={val[i] ?? ""} onChange={(e) => setVal((x) => ({ ...x, [i]: e.target.value }))} onBlur={(e) => ck.instant && e.target.value && ck.bump(String(i))} aria-label={`sentence ${i + 1}`} />
              {g === "spelling" && <span className="small text-warn">{t("tk.spelling")}: {s}</span>}
              {g === "wrong" && ck.reveal(String(i)) && <span className="tk-ans">{s}</span>}
            </div>
          </div>
        );
      })}
      <CheckBar ck={ck} errors={errors} total={p.items.length} onReset={() => setVal((x) => Object.fromEntries(Object.entries(x).filter(([k]) => grade(+k) === "exact")))} />
    </div>
  );
}

// ───────── Кроссворд ─────────
function CrosswordView({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options;
  const cw = useMemo(() => { const p = parse("crossword", task.content); return p.kind === "words" && p.items.length ? buildCrossword(p.items) : null; }, [task.content]);
  const ck = useChecker(o, task.id);
  const [cell, setCell] = useSlot<Record<string, string>>(task.id, "cell", {});
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  if (!cw) return <p className="hint">{t("tk.empty")}</p>;
  const nums = new Map(cw.words.map((w) => [`${w.row},${w.col}`, w.n]));
  const wordOk = (w: (typeof cw.words)[number]) => w.word.split("").every((ch, i) => (cell[`${w.across ? w.row : w.row + i},${w.across ? w.col + i : w.col}`] ?? "").toUpperCase() === ch);
  const errors = cw.words.filter((w) => !wordOk(w)).length;
  const okCells = new Set(cw.words.filter(wordOk).flatMap((w) => w.word.split("").map((_, i) => `${w.across ? w.row : w.row + i},${w.across ? w.col + i : w.col}`)));
  return (
    <div className="flex flex-col gap-4">
      <div className="tk-cw" style={{ gridTemplateColumns: `repeat(${cw.cols}, 34px)` }}>
        {cw.grid.flatMap((row, r) => row.map((ch, c) => {
          const k = `${r},${c}`;
          if (!ch) return <div key={k} />;
          const m = ck.checked && cell[k] ? (okCells.has(k) ? "ok" : cell[k].toUpperCase() === ch ? "" : "bad") : "";
          return (
            <div key={k} className="tk-cell">
              {nums.has(k) && <span className="tk-cn">{nums.get(k)}</span>}
              <input ref={(el) => { refs.current[k] = el; }} maxLength={1} className={m} value={cell[k] ?? ""} aria-label={`cell ${r + 1}-${c + 1}`}
                onChange={(e) => {
                  const v = e.target.value.slice(-1);
                  setCell((x) => ({ ...x, [k]: v }));
                  if (v) (refs.current[`${r},${c + 1}`] ?? refs.current[`${r + 1},${c}`])?.focus();
                }} />
            </div>
          );
        }))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {[true, false].map((across) => (
          <div key={String(across)}>
            <div className="small mb-1 font-semibold text-text2">{across ? t("tk.across") : t("tk.down")}</div>
            {cw.words.filter((w) => w.across === across).sort((a, b) => a.n - b.n).map((w) => (
              <div key={w.n + w.word} className={`small ${ck.checked ? (wordOk(w) ? "text-ok" : "") : ""}`}><b>{w.n}.</b> {w.clue || "—"} ({w.word.length})</div>
            ))}
          </div>
        ))}
      </div>
      <CheckBar ck={ck} errors={errors} total={cw.words.length} onReset={() => setCell((x) => Object.fromEntries(Object.entries(x).filter(([k]) => okCells.has(k))))} />
    </div>
  );
}

// ───────── Материалы и открытые ответы ─────────
/** Строчное оформление: **жирный**, *курсив*, __подчёркнутый__, ==маркер==, {blue}цвет{/} (blue, red, green, purple, orange). */
const COLORS = ["blue", "red", "green", "purple", "orange"];
export function inlineHtml(text: string) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>").replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/==(.+?)==/g, '<mark class="tk-mark">$1</mark>')
    .replace(/\{(\w+)\}([\s\S]+?)\{\/\w*\}/g, (m, c: string, x: string) => (COLORS.includes(c) ? `<span class="tk-c-${c}">${x}</span>` : m));
}
/** Короткий текст с оформлением (вопрос, утверждение, строка задания). */
export function Inl({ text }: { text: string }) {
  return /[*_={]/.test(text) ? <span dangerouslySetInnerHTML={{ __html: inlineHtml(text) }} /> : <>{text}</>;
}
function Rich({ text }: { text: string }) {
  const html = inlineHtml(text).split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("");
  return <div className="tk-rich" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Images({ o }: { o: TaskOptions }) {
  const { t } = useT();
  const imgs = o.images ?? [];
  const [i, setI] = useState(0);
  if (!imgs.length) return <div className="tk-empty"><Icon name="image" />{t("tk.noImages")}</div>;
  if (o.layout === "stack" || imgs.length === 1)
    return <div className="flex flex-col gap-3">{imgs.map((im, k) => <figure key={k} className="m-0"><img src={im.src} alt={im.caption ?? ""} className="tk-img" />{im.caption && <figcaption className="small muted mt-1">{im.caption}</figcaption>}</figure>)}</div>;
  const im = imgs[Math.min(i, imgs.length - 1)];
  return (
    <figure className="m-0">
      <div className="relative">
        <img src={im.src} alt={im.caption ?? ""} className="tk-img" />
        <button type="button" className="tk-nav l" onClick={() => setI((i - 1 + imgs.length) % imgs.length)} aria-label="prev"><Icon name="chevl" /></button>
        <button type="button" className="tk-nav r" onClick={() => setI((i + 1) % imgs.length)} aria-label="next"><Icon name="right" /></button>
      </div>
      <figcaption className="small muted mt-1 text-center">{im.caption} · {i + 1}/{imgs.length}</figcaption>
    </figure>
  );
}

function Script({ o }: { o: TaskOptions }) {
  const { t } = useT();
  const [open, setOpen] = useState(!!o.showScript);
  if (!o.script) return null;
  return (
    <div className="mt-3">
      <button type="button" className="btn plain sm" onClick={() => setOpen(!open)}>{open ? t("tk.hideScript") : t("tk.showScript")}</button>
      {open && <div className="tk-script"><Rich text={o.script} /></div>}
    </div>
  );
}

function Recorder({ task }: { task: TaskData }) {
  const { t } = useT();
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useSlot<{ transcript?: string; check?: AiCheck } | null>(task.id, "rec", null);
  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => { const b = new Blob(chunks, { type: r.mimeType }); setBlob(b); setUrl(URL.createObjectURL(b)); stream.getTracks().forEach((x) => x.stop()); };
      r.start(); setRec(r);
    } catch { setErr(t("tk.micError")); }
  };
  // расшифровка → исправленная версия
  const decode = async () => {
    if (!blob) return;
    setBusy(true); setErr(null);
    try {
      const transcript = (await transcribe(blob)).trim();
      if (!transcript) { setErr(t("ai.notHeard")); return; }
      const r = await fixSpeech(task.id, transcript).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
      setSaved({ transcript, check: r.ok ? { ...r.check, source: transcript } : undefined });
      if (!r.ok) setErr(r.error);
    } catch (e) { const c = String((e as Error).message); setErr(["limit", "tariff", "off", "fail"].includes(c) ? t(`ai.err.${c}` as "ai.err.fail") : c); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2">
      {rec ? (
        <button type="button" className="btn danger lg w-full" onClick={() => { rec.stop(); setRec(null); }}><span className="dot" style={{ background: "var(--bad)" }} />{t("tk.stop")}</button>
      ) : (
        <button type="button" className="btn primary lg w-full" onClick={start}><Icon name="mic" />{url ? t("tk.recordAgain") : t("tk.record")}</button>
      )}
      {url && <audio controls src={url} className="w-full" />}
      {blob && !rec && <button type="button" className="btn tinted sm self-start" disabled={busy} onClick={decode}><Icon name="spark" size="sm" />{busy ? t("ai.thinking") : t("tk.transcript")}</button>}
      {saved?.transcript && <div className="small"><b>{t("ai.transcript")}:</b> {saved.transcript}</div>}
      {saved?.check && <AiCheckView check={saved.check} />}
      {err && <span className="small text-bad">{err}</span>}
    </div>
  );
}

// ───────── Задание целиком ─────────
export function TaskBody({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options ?? {};
  const p = parse(task.type, task.content);
  switch (task.type) {
    case "gap":
    case "drag":
      return <Gaps key={task.content + o.mode + o.split + o.seriesSize} task={task} kind="gap" />;
    case "dropdown":
      return <Gaps key={task.content} task={task} kind="dropdown" />;
    case "errors": return <Errors key={task.content} task={task} />;
    case "mark": return <MarkWords key={task.content} task={task} />;
    case "test": return <Test key={task.content} task={task} />;
    case "tf": return <TF key={task.content} task={task} />;
    case "pairs": return <Pairs key={task.content} task={task} />;
    case "columns": return <Sort key={task.content} task={task} />;
    case "picture": return <Sort key={task.content + (o.pics ?? []).join()} task={task} pictures />;
    case "sentence": return <Build key={task.content} task={task} />;
    case "letters": return <Build key={task.content + o.limitSec} task={task} letters />;
    case "textorder": return <Order key={task.content} task={task} />;
    case "transform":
    case "translate": return <Arrow key={task.content} task={task} />;
    case "dictation": return <Dictation key={task.content} task={task} />;
    case "crossword": return <CrosswordView key={task.content} task={task} />;
    case "image": return <Images o={o} />;
    case "video": {
      const v = videoEmbed(o.src ?? "", { start: o.clipStart, end: o.clipEnd });
      return (
        <div>
          {(o.clipStart || o.clipEnd) && v ? <div className="small muted mb-2 flex items-center gap-1"><Icon name="clock" size="sm" />{t("tk.clip", { a: fmtTime(o.clipStart ?? 0), b: o.clipEnd ? fmtTime(o.clipEnd) : "…" })}</div> : null}
          {!v ? <div className="tk-empty"><Icon name="video" />{t("tk.noVideo")}</div> : v.kind === "file" ? <video src={v.src} controls className="tk-img" /> : <iframe src={v.src} className="tk-video" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen title={task.title} />}
          <Script o={o} />
        </div>
      );
    }
    case "audio":
      return <div>{o.src ? <audio controls src={o.src} className="w-full" /> : <div className="tk-empty"><Icon name="sound" />{t("tk.noAudio")}</div>}<Script o={o} /></div>;
    case "text": return <div>{o.images?.[0] && <img src={o.images[0].src} alt="" className="tk-img mb-3" />}{o.markable ? <MarkWords task={task} /> : <Rich text={task.content} />}</div>;
    case "note": return <div className="tk-note"><Rich text={task.content} /></div>;
    case "vocab": return p.kind === "lines" ? <div className="tk-vocab-items">{p.items.map((w, i) => <span key={i} className="tk-vocab-w"><Inl text={w} /></span>)}</div> : null;
    case "link": return o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="btn tinted"><Icon name="link" size="sm" />{o.label || o.url}</a> : <div className="tk-empty"><Icon name="link" />{t("tk.noLink")}</div>;
    case "divider": return <hr className="tk-hr" />;
    case "wordset":
      return p.kind === "wordset" ? (
        <div className="tk-words">
          {p.items.map((w, i) => (
            <div key={i} className="tk-wcard">
              <div className="flex items-center gap-2"><b className="text-[17px]">{w.word}</b><button type="button" className="iconbtn" onClick={() => speak(w.word)} aria-label={t("tk.listen")}><Icon name="sound" size="sm" /></button></div>
              {w.tr && <div className="muted">{w.tr}</div>}
              {w.ex && <div className="small mt-1" dangerouslySetInnerHTML={{ __html: w.ex.replace(/[<>&]/g, "").replace(new RegExp(`\\b(${w.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"), "<b>$1</b>") }} />}
              <input className="input mt-2" placeholder={t("tk.ownExample")} aria-label={t("tk.ownExample")} />
            </div>
          ))}
        </div>
      ) : null;
    case "speak":
      return (
        <div className="flex flex-col gap-3">
          {/* один вопрос — без номера строки */}
          {p.kind === "lines" && p.items.map((q, i) => <div key={i}>{p.items.length > 1 && <Num i={i} o={o} />} <Inl text={q} /></div>)}
          <AiTalk task={task} />
        </div>
      );
    case "open": return <Open task={task} />;
    case "essay": return <Essay task={task} />;
    case "record": return <div className="flex flex-col gap-3">{task.content && <Rich text={task.content} />}<Recorder task={task} /></div>;
    default: return null;
  }
}

function Open({ task }: { task: TaskData }) {
  const { t } = useT();
  const p = parse("open", task.content);
  const [val, setVal] = useSlot<Record<number, string>>(task.id, "val", {});
  return (
    <div className="flex flex-col gap-4">
      {p.kind === "lines" && p.items.map((q, i) => (
        <div key={i}><div className="mb-1.5">{p.items.length > 1 && <Num i={i} o={task.options} />} <Inl text={q} /></div>
          <textarea className="textarea" aria-label={q} value={val[i] ?? ""} onChange={(e) => setVal((x) => ({ ...x, [i]: e.target.value }))} /></div>
      ))}
      <span className="hint">{t("tk.teacherChecks")}</span>
    </div>
  );
}

function Essay({ task }: { task: TaskData }) {
  const { t } = useT();
  const [v, setV] = useSlot<string>(task.id, "text", "");
  const words = v.trim() ? v.trim().split(/\s+/).length : 0;
  const lim = task.options.limitWords;
  return (
    <div className="flex flex-col gap-2">
      {task.content && <Rich text={task.content} />}
      <textarea className="textarea" style={{ minHeight: 180 }} value={v} onChange={(e) => setV(e.target.value)} placeholder={t("tk.essayPh")} aria-label={t("tk.essayPh")} />
      <span className={`small ${lim && words > lim ? "text-bad" : "text-text3"}`}>{t("tk.words", { n: words })}{lim ? ` / ${lim}` : ""} · {t("tk.teacherChecks")}</span>
    </div>
  );
}

/** Формулировка: строки — отдельными строками, пустая строка — отступ между абзацами. */
export function TitleText({ text }: { text: string }) {
  if (!text.includes("\n")) return <Inl text={text} />;
  return <>{text.split("\n").map((l, i) => (l.trim() ? <span key={i} className="tk-tl"><Inl text={l} /></span> : <span key={i} className="tk-tgap" aria-hidden />))}</>;
}

/** Useful phrases под формулировкой: свёрнуты, ученик открывает, когда нужна помощь. */
function HelpPhrases({ task }: { task: TaskData }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const h = task.options.help;
  const list = (x?: string) => (x ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const vocab = list(h?.vocab), grammar = list(h?.grammar);
  if (!vocab.length && !grammar.length) return null;
  return (
    <div className="tk-help">
      <button type="button" className="tk-help-btn" aria-expanded={open} onClick={() => setOpen((x) => !x)}><Icon name={open ? "eyeoff" : "eye"} size="sm" />{t("tk.help")}</button>
      {open && (
        <div className="tk-help-box">
          {vocab.length > 0 && <div><b>{t("tk.helpVocab")}</b><ul className="tk-help-v">{vocab.map((x, i) => <li key={i}><Inl text={x} /></li>)}</ul></div>}
          {grammar.length > 0 && <div><b>{t("tk.helpGrammar")}</b><ul className="tk-help-g">{grammar.map((x, i) => <li key={i}><Inl text={x} /></li>)}</ul></div>}
        </div>
      )}
    </div>
  );
}

/** Карточка задания: номер + формулировка + содержимое. */
export function TaskCard({ task, index, actions }: { task: TaskData; index: number; actions?: React.ReactNode }) {
  if (task.type === "divider") return <hr className="tk-hr" />;
  // рамка Useful vocabulary: без номера, заголовок — внутри рамки
  if (task.type === "vocab")
    return (
      <article className="tk tk-vocab">
        <header className="tk-head"><h3 className="tk-title tk-vocab-t"><Inl text={task.title || "Useful vocabulary"} /></h3>{actions}</header>
        <TaskBody task={task} />
      </article>
    );
  const head = !!task.title.trim() || !!actions; // нет формулировки — нет ни номера, ни пустой шапки
  return (
    <article className="tk">
      {head && <header className="tk-head">
        {index >= 0 && numbered(task) && <span className="tk-num">{index + 1}</span>}
        <h3 className="tk-title"><TitleText text={task.title} /></h3>
        {actions}
      </header>}
      <HelpPhrases task={task} />
      <TaskBody task={task} />
    </article>
  );
}
