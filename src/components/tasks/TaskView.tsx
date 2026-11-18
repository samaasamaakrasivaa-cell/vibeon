"use client";
// Задание глазами ученика: показ и проверка для всех типов конструктора.
// Используется в превью конструктора («Ученик увидит»), в «Поделиться», а на этапах 5–6 — в уроке и кабинете ученика.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { numbered, type TaskOptions, type TaskType } from "@/lib/tasks/catalog";
import { buildCrossword, dictationGrade, fmtTime, parse, same, series, shuffle, videoEmbed, type Seg } from "@/lib/tasks/parse";
import { Icon } from "../Icon";
import { useSlot, useTaskRole } from "./store";
import { AiTalk } from "../ai/AiTalk";
import { AiCheckView, type AiCheck } from "../ai/AiCheckView";
import { transcribe } from "../ai/audio";
import { fixSpeech } from "@/lib/ai/actions";
import { wordDiff } from "@/lib/ai/diff";

export type TaskData = { id: string; type: TaskType; title: string; content: string; options: TaskOptions };
type Mark = "ok" | "bad" | "spell" | undefined;

type Try = { v: string; ok: boolean };

/** Попытки ученика у поля — в самом уроке, у учителя и у ученика (в конструкторе их нет: там ещё нечего показывать).
 *  Ученик видит свои попытки и комментарий учителя, но не правильный ответ и не поле комментария.
 *  Три точки вертикально рядом с ответом: серые — попыток нет, красная — неверная, зелёная — верная.
 *  Нажать — какие варианты ученик вводил по очереди и комментарий учителя к этому ответу (его видит ученик). */
function Tries({ hist = [], answer, tid, k }: { hist?: Try[]; answer: string; tid: string; k: string; noKey?: boolean }) {
  const { t } = useT();
  const role = useTaskRole();
  const key = useKey();
  const [notes, setNotes] = useSlot<Record<string, string>>(tid, "gnotes", {});
  const note = notes[k] ?? "";
  const [open, setOpenRaw] = useState(false);
  const [draft, setDraft] = useState(note);
  const box = useRef<HTMLSpanElement>(null);
  // окно — поверх страницы (карточка задания обрезает всё, что выходит за её край)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const setOpen = (v: boolean) => {
    if (v && box.current) { const r = box.current.getBoundingClientRect(); setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 296)), top: r.bottom + 6 }); }
    setOpenRaw(v);
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setOpenRaw(false);
    window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  const popStyle = at ? { position: "fixed" as const, left: at.left, top: at.top } : undefined;
  useEffect(() => { if (!open) setDraft(note); }, [note, open]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  const save = () => { const v = draft.trim(); if (v !== note) setNotes((n) => { const x = { ...n }; if (v) x[k] = v; else delete x[k]; return x; }); };
  // конструктор: точек нет; правильный ответ всплывает зелёным словом при наведении на сам пропуск (data-ans),
  // а у перефраза он показан строкой под заданием — рядом с полем ничего не дублируем
  if (role === "guest") return null;
  const student = role === "student";
  // ученик видит свои точки, если уже отвечал или учитель оставил комментарий
  if (student && !hist.length && !note) return null;
  const dots = hist.length <= 3 ? hist : [hist[0], hist[1], hist[hist.length - 1]];
  return (
    <span ref={box} className="tk-tries">
      <button type="button" className={`tk-tries-dots ${note ? "noted" : ""}`} aria-expanded={open} aria-label={t("tk.tries")} title={t("tk.tries")} onClick={() => setOpen(!open)}>
        {[0, 1, 2].map((i) => <i key={i} className={dots[i] ? (dots[i].ok ? "ok" : "bad") : ""} />)}
      </button>
      {open && (
        <span className="tk-tries-pop on" style={popStyle}>
          {key && !student && <span className="tk-tries-ans">✓ {answer}</span>}
          {student && hist.length > 0 && <b className="small">{t("tk.myTries")}</b>}
          {hist.length ? hist.map((h, i) => <span key={i} className={h.ok ? "ok" : "bad"}>{t("tk.tryN", { n: i + 1 })}: {h.v} {h.ok ? "✓" : "✗"}</span>) : <span className="muted">{t("tk.noTries")}</span>}
          {student ? note && <span className="tk-gnote-box"><b className="small">{t("tk.noteFromTeacher")}</b><span className="tk-gnote-txt">{note}</span></span> : <>
            <textarea className="tk-tries-note" rows={2} value={draft} placeholder={t("tk.notePh")} aria-label={t("tk.notePh")}
              onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); setOpen(false); } }} />
            <span className="small muted">{t("tk.noteHint")}</span>
          </>}
        </span>
      )}
    </span>
  );
}

/** Общая логика проверки: «сразу» (до 3 попыток) или кнопкой «Проверить». */
function useChecker(o: TaskOptions, id: string) {
  const instant = (o.checkMode ?? "button") === "instant";
  // учитель подставил ответ за ученика — это не попытка ученика: в точки и счётчик попыток не идёт
  const byTeacher = useTaskRole() === "teacher";
  const [checked, setChecked] = useSlot(id, "checked", false);
  const [tries, setTries] = useSlot<Record<string, number>>(id, "tries", {});
  const bump = (k: string) => !byTeacher && setTries((t) => ({ ...t, [k]: (t[k] ?? 0) + 1 }));
  const reveal = (k: string) => !o.noreveal && (tries[k] ?? 0) >= 3;
  // история попыток по каждому полю: что ученик отвечал и верно ли (учитель видит её по точкам у поля)
  const [hist, setHist] = useSlot<Record<string, Try[]>>(id, "hist", {});
  const record = (k: string, v: string, ok: boolean) => {
    if (!v.trim() || byTeacher) return;
    setHist((h) => { const a = h[k] ?? []; if (a.length && a[a.length - 1].v === v) return h; return { ...h, [k]: [...a, { v, ok }].slice(-10) }; });
  };
  return { instant, checked: instant || checked, setChecked, tries, bump, reveal, hist, record, reset: () => { setChecked(false); setTries({}); setHist({}); } };
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

/** Режим «ответы» у учителя (урок, конструктор, редактор): правильный ответ виден заранее. Ученику — никогда. */
export const KeyCtx = createContext(false);
function useKey() { const on = useContext(KeyCtx); const role = useTaskRole(); return on && role !== "student"; }
function Key({ text, pre = "✓", mode = "inline" }: { text: string; pre?: string; mode?: "inline" | "pop" | "block" }) {
  const on = useKey();
  if (!on || !text) return null;
  if (mode === "pop") return <span className="tk-key-dot" tabIndex={0} aria-label={`${pre} ${text}`}><i /><i /><i /><span className="tk-key-pop">{text}</span></span>;
  if (mode === "block") return <span className="tk-key-line">✓ {text}</span>;
  return <span className="tk-key-hint">{pre} {text}</span>;
}

/** Выпадающий список пропуска — свой, а не системный: у учителя правильный вариант подсвечен зелёным прямо в списке. */
function Drop({ value, options, answers, onChange, mark, label }: { value: string; options: string[]; answers: string[]; onChange: (v: string) => void; mark?: string; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const key = useKey();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  return (
    <span className="tk-dd" ref={box}>
      <button type="button" className={`tk-sel ${mark ?? ""} ${value ? "full" : ""}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label} data-ans={key ? answers.join(" / ") : undefined} onClick={() => setOpen((x) => !x)}>
        {value && <span className="grow">{value}</span>}<Icon name="chevd" size="sm" />
      </button>
      {open && (
        <span className="tk-dd-pop" role="listbox">
          {options.map((x) => (
            <button key={x} type="button" role="option" aria-selected={value === x} className={`tk-dd-opt ${value === x ? "on" : ""} ${key && answers.includes(x) ? "right" : ""}`} onClick={() => { onChange(x); setOpen(false); }}>{x}</button>
          ))}
        </span>
      )}
    </span>
  );
}

// ───────── Пропуски / выбор из списка ─────────
function Gaps({ task, kind }: { task: TaskData; kind: "gap" | "dropdown" }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse(task.type, task.content), [task.type, task.content]);
  const drag = kind === "gap" && (task.type === "drag" || o.mode === "drag");
  const ck = useChecker(o, task.id);
  const [val, setVal] = useSlot<Record<string, string>>(task.id, "val", {});
  const [pick, setPick] = useState<string | null>(null);
  const key = useKey(); // учителю правильный ответ всплывает зелёным словом при наведении на пропуск
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
  const ansOf = (k: string) => gapKeys.find((x) => x.k === k)?.s.answers ?? [];
  const set = (k: string, v: string) => { setVal((x) => ({ ...x, [k]: v })); if (ck.instant && v) { ck.bump(k); ck.record(k, v, same(v, ansOf(k))); } };
  const recordAll = () => gapKeys.forEach(({ k, s }) => val[k] && ck.record(k, val[k], same(val[k], s.answers)));

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
                          <span key={si} className="tk-gapw">
                            <Drop value={val[k] ?? ""} options={s.options!} answers={s.answers} onChange={(v) => set(k, v)} mark={m} label={`gap ${i + 1}`} />
                            <Tries hist={ck.hist[k]} answer={s.answers.join(" / ")} tid={task.id} k={k} />
                          </span>
                        );
                      if (drag)
                        return (
                          <span key={si} className="tk-gapw">
                          <button type="button" data-ans={key ? s.answers.join(" / ") : undefined} className={`tk-slot ${m ?? ""} ${val[k] ? "full" : ""}`}
                            onClick={() => { if (pick) { set(k, pick); setPick(null); } else set(k, ""); }}
                            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); set(k, e.dataTransfer.getData("text/plain")); }}>
                            {val[k] || " "}
                          </button>
                          <Tries hist={ck.hist[k]} answer={s.answers.join(" / ")} tid={task.id} k={k} />
                          </span>
                        );
                      return (
                        <span key={si} className="tk-gapw" data-ans={key ? s.answers.join(" / ") : undefined}>
                          <input className={`tk-gap ${m ?? ""}`} value={val[k] ?? ""} size={Math.max(4, Math.max((s.answers[0] ?? "").length, (val[k] ?? "").length) + 1)}
                            onChange={(e) => setVal((x) => ({ ...x, [k]: e.target.value }))} onBlur={(e) => { if (ck.instant && e.target.value) { ck.bump(k); ck.record(k, e.target.value, same(e.target.value, s.answers)); } }}
                            aria-label={`gap ${i + 1}`} />
                          {s.hint && <span className="tk-hint" title={t("tk.baseWord")}>{s.hint}</span>}
                          {shown && <span className="tk-ans">{s.answers[0]}</span>}
                          <Tries hist={ck.hist[k]} answer={s.answers.join(" / ")} tid={task.id} k={k} />
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
      <CheckBar ck={ck} errors={errors} total={gapKeys.length} onCheck={recordAll} onReset={() => setVal((v) => Object.fromEntries(Object.entries(v).filter(([k]) => { const g = gapKeys.find((x) => x.k === k); return g && same(v[k], g.s.answers); })))} />
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
  const keyE = useKey();
  const role = useTaskRole();
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
                // учителю: слово с ошибкой подсвечено, а как правильно — всплывает при наведении (без точек, их легко принять за попытки)
                if (!found[i]) return <span key={si} className="tk-gapw" data-ans={keyE ? `→ ${s.answers[0]}` : undefined}><span className={`tk-word ${keyE ? "tk-key-err" : ""}`} onClick={() => setFound((f) => ({ ...f, [i]: true }))}>{wrong}</span></span>;
                const m: Mark = ck.checked && fix[i] ? (same(fix[i], s.answers) ? "ok" : "bad") : undefined;
                return (
                  <span key={si} className="tk-gapw">
                    <s className="text-bad">{wrong}</s>{" "}
                    <span className="tk-gapw" data-ans={keyE ? s.answers.join(" / ") : undefined}>
                      <input autoFocus={role === "student"} className={`tk-gap ${m ?? ""}`} value={fix[i] ?? ""} size={Math.max(4, (s.answers[0] ?? "").length + 1)} onChange={(e) => setFix((x) => ({ ...x, [i]: e.target.value }))}
                        onBlur={(e) => { if (ck.instant && e.target.value) { ck.bump(String(i)); ck.record(String(i), e.target.value, same(e.target.value, s.answers)); } }} aria-label="fix" />
                    </span>
                    {ck.reveal(String(i)) && m === "bad" && <span className="tk-ans">{s.answers[0]}</span>}
                    {/* точки попыток: сколько раз ученик исправлял и верно ли — как в остальных заданиях */}
                    <Tries hist={ck.hist[String(i)]} answer={s.answers.join(" / ")} tid={task.id} k={String(i)} />
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ol>
      <CheckBar ck={ck} errors={errors} total={p.lines.length} onReset={() => { setMiss({}); }}
        onCheck={() => p.lines.forEach((l, i) => { const g = l.find((x) => x.t === "gap") as Extract<Seg, { t: "gap" }> | undefined; if (g && found[i] && fix[i]) ck.record(String(i), fix[i], same(fix[i], g.answers)); })} />
    </div>
  );
}

// ───────── Выдели слова в тексте ─────────
// Инструмент работы с текстом: ученик нажимает на слова — они выделяются для него, повторное нажатие снимает. Правильных ответов нет.
// На уроке (MarkCtx): учитель по умолчанию работает со своими выделениями; выделения ученика смотрит по выбору
// (в группе — имя ученика у задания, на индивидуальном уроке — «Мои / Ученик»). «Показать ученикам» — ученики видят
// выделения учителя подчёркиванием его цвета, поверх своих. Цвета: 4 — у учителя и у ученика.
export type MarkMap = Record<string, number>; // слово → цвет
export type MarkLayer = {
  teacher: boolean; group: boolean; student: string; // student — чьи выделения смотрим (в группе — выбранный ученик, иначе пусто)
  mine: Record<string, MarkMap>; shown: string[]; setMine: (taskId: string, m: MarkMap) => void; toggleShown: (taskId: string) => void;
  view: Record<string, "mine" | "student">; setView: (taskId: string, v: "mine" | "student") => void; // индивидуальный урок: что смотрит учитель (не сбрасывается при смене секции)
  members?: { sid: string; name: string }[]; sid?: string; pick?: (taskId: string, sid: string) => void; // группа: переключатель «Мои / ученики» прямо у задания
};
export const MarkCtx = createContext<MarkLayer | null>(null);
export const MARK_COLORS = ["yellow", "green", "blue", "red"] as const;
let LAST_COLOR = 0; // выбранный цвет помним между заданиями и секциями
/** Старые выделения: список слов → всё жёлтым (0). */
export const markMap = (x: unknown): MarkMap => (Array.isArray(x) ? Object.fromEntries(x.map((i) => [String(i), 0])) : x && typeof x === "object" ? (x as MarkMap) : {});

function MarkWords({ task, content }: { task: TaskData; content?: string }) {
  const { t } = useT();
  const p = useMemo(() => parse("mark", content ?? task.content), [content, task.content]);
  const [sel, setSel] = useSlot<Record<number, boolean | number>>(task.id, "sel", {});
  const ctx = useContext(MarkCtx);
  const role = useTaskRole();
  const teacher = !!ctx?.teacher && role === "teacher";
  const view: "own" | "mine" | "student" = !teacher ? "own" : ctx!.group ? (ctx!.student ? "student" : "mine") : ctx!.view[task.id] ?? "mine";
  const [color, setColorS] = useState(LAST_COLOR);
  const setColor = (c: number) => { LAST_COLOR = c; setColorS(c); };
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragRef = useRef(drag); dragRef.current = drag;
  const mine = useMemo(() => markMap(ctx?.mine[task.id]), [ctx?.mine, task.id]);
  // ученик: true из старых ответов — жёлтый; число — 1 + номер цвета
  const own = useMemo(() => Object.fromEntries(Object.entries(sel).filter(([, v]) => v).map(([k, v]) => [k, typeof v === "number" ? v - 1 : 0])) as MarkMap, [sel]);
  const shown = !!ctx?.shown.includes(task.id);
  const canEdit = view === "own" || view === "mine";
  const cur: MarkMap = view === "mine" ? mine : own;
  const put = (n: MarkMap) => {
    if (view === "mine") ctx!.setMine(task.id, n);
    else setSel(Object.fromEntries(Object.entries(n).map(([k, c]) => [k, c + 1])));
  };
  // фрагмент — соседние слова одного цвета
  const run = (i: number, M: MarkMap) => { const c = M[i]; const r = [i]; for (let k = i - 1; M[k] === c; k--) r.push(k); for (let k = i + 1; M[k] === c; k++) r.push(k); return r; };
  const tap = (i: number) => {
    if (!canEdit) return;
    const n = { ...cur };
    if (n[i] !== undefined && n[i] === color) run(i, n).forEach((k) => delete n[k]); // нажали на фрагмент этого цвета — снять
    else if (n[i] !== undefined) run(i, n).forEach((k) => { n[k] = color; }); // другого цвета — перекрасить
    else n[i] = color;
    put(n);
  };
  const range = (a: number, b: number) => {
    if (!canEdit) return;
    const lo = Math.min(a, b), hi = Math.max(a, b), n = { ...cur };
    const all = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
    if (all.every((k) => n[k] === color)) all.forEach((k) => delete n[k]); else all.forEach((k) => { n[k] = color; });
    put(n);
  };
  useEffect(() => {
    if (!drag) return;
    const up = () => { const d = dragRef.current; setDrag(null); if (!d) return; if (d.from === d.to) tap(d.from); else range(d.from, d.to); };
    const cancel = () => setDrag(null);
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);
  if (p.kind !== "mark") return null;
  const inDrag = (i: number) => !!drag && i >= Math.min(drag.from, drag.to) && i <= Math.max(drag.from, drag.to);
  // заливка — свои выделения (ученика или учителя); подчёркивание — выделения учителя, показанные ученику
  const layers = (i: number): { fill?: number; line?: number } => {
    if (view === "mine") return { fill: mine[i] };
    if (view === "student") return { fill: own[i], line: shown ? mine[i] : undefined };
    return { fill: own[i], line: shown ? mine[i] : undefined };
  };
  const cls = (l: { fill?: number; line?: number }) => `${l.fill !== undefined ? `on c${l.fill}` : ""} ${l.line !== undefined ? `tch t${l.line}` : ""}`;
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-w]");
    const w = el ? Number(el.getAttribute("data-w")) : NaN;
    if (Number.isFinite(w) && w !== drag.to) setDrag({ ...drag, to: w });
  };
  const has = Object.keys(cur).length > 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="tk-mkbar">
        {teacher && !ctx!.group && (
          <div className="seg" role="group" aria-label={t("tk.markView")}>
            <button type="button" aria-pressed={view === "mine"} onClick={() => ctx!.setView(task.id, "mine")}>{t("tk.markMine")}</button>
            <button type="button" aria-pressed={view === "student"} onClick={() => ctx!.setView(task.id, "student")}>{t("tk.markStudent", { name: ctx!.student })}</button>
          </div>
        )}
        {teacher && ctx!.group && ctx!.members?.length && ctx!.pick ? (
          <div className="seg" role="group" aria-label={t("tk.markView")}>
            <button type="button" aria-pressed={view === "mine"} onClick={() => ctx!.pick!(task.id, "")}>{t("tk.markMine")}</button>
            {ctx!.members.map((m) => <button key={m.sid} type="button" aria-pressed={ctx!.sid === m.sid} onClick={() => ctx!.pick!(task.id, m.sid)}>{m.name.split(" ")[0]}</button>)}
          </div>
        ) : teacher && ctx!.group && <span className="small muted">{view === "student" ? t("tk.markOf", { name: ctx!.student }) : t("tk.markMineHint")}</span>}
        {canEdit && (
          <span className="tk-mkcolors" role="radiogroup" aria-label={t("tk.markColor")}>
            {MARK_COLORS.map((c, ci) => <button key={c} type="button" role="radio" aria-checked={color === ci} aria-label={t(`tk.mc.${c}` as DictKey)} title={t(`tk.mc.${c}` as DictKey)} className={`tk-mkc c${ci} ${color === ci ? "on" : ""}`} onClick={() => setColor(ci)} />)}
          </span>
        )}
        {view === "mine" && <button type="button" className={`btn sm ${shown ? "primary" : "secondary"}`} disabled={!has && !shown} onClick={() => ctx!.toggleShown(task.id)}><Icon name={shown ? "eye" : "eyeoff"} size="sm" />{shown ? t(ctx!.group ? "tk.markShownAll" : "tk.markShown") : t(ctx!.group ? "tk.markShowAll" : "tk.markShow")}</button>}
        {canEdit && has && <button type="button" className="btn plain sm" onClick={() => put({})}>{view === "mine" ? t("tk.markClearMine") : t("tk.markClear")}</button>}
      </div>
      {!teacher && <p className="hint m-0">{t("tk.markFree")}{shown && Object.keys(mine).length ? ` ${t("tk.markTeacherOn")}` : ""}</p>}
      <div className={`tk-marktext ${canEdit ? "" : "ro"}`} onPointerMove={onMove}>
        {p.lines.map((line, li) => (
          <p key={li} className="m-0">
            {line.length === 0 ? "\u00a0" : line.map((x, k) => {
              if (x.t === "x") {
                // промежуток внутри фрагмента закрашивается вместе со словами — фрагмент выглядит одной плашкой
                const a = line[k - 1], b = line[k + 1];
                if (a?.t !== "w" || b?.t !== "w") return <span key={k}>{x.v}</span>;
                const la = layers(a.i), lb = layers(b.i);
                const g = { fill: la.fill !== undefined && la.fill === lb.fill ? la.fill : undefined, line: la.line !== undefined && la.line === lb.line ? la.line : undefined };
                const c = `${cls(g)} ${inDrag(a.i) && inDrag(b.i) ? "drag" : ""}`.trim();
                return <span key={k} className={c ? `tk-mk-gap ${c}` : undefined}>{x.v}</span>;
              }
              const l = layers(x.i);
              return (
                <span key={k} data-w={x.i} role="button" tabIndex={0} aria-pressed={l.fill !== undefined || l.line !== undefined} className={`tk-mk ${cls(l)} ${inDrag(x.i) ? "drag" : ""}`}
                  onPointerDown={(e) => { if (!canEdit || e.button > 0) return; e.preventDefault(); setDrag({ from: x.i, to: x.i }); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(x.i); } }}>{x.v}</span>
              );
            })}
          </p>
        ))}
      </div>
    </div>
  );
}

// ───────── Тест ─────────
function Test({ task }: { task: TaskData }) {
  const o = task.options;
  const p = useMemo(() => parse("test", task.content), [task.content]);
  const ck = useChecker(o, task.id);
  const [ans, setAns] = useSlot<Record<number, number[]>>(task.id, "ans", {});
  const keyT = useKey();
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
                  <label key={oi} data-right={q.correct.includes(oi) ? "1" : undefined} className={`tk-opt ${sel ? "sel" : ""} ${m ?? ""} ${keyT && q.correct.includes(oi) ? "tk-right" : ""}`}>
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
  const keyF = useKey();
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
              return <button key={v} type="button" aria-pressed={sel} className={`${m ? `tk-${m}` : ""} ${keyF && v === it.a ? "tk-right" : ""}`} onClick={() => { setAns((a) => ({ ...a, [i]: v })); if (ck.instant) ck.bump(String(i)); }}>{l}</button>;
            })}
          </div>
        </div>
      ))}
      <CheckBar ck={ck} errors={errors} total={p.items.length} onReset={() => setAns((a) => Object.fromEntries(Object.entries(a).filter(([k, v]) => p.items[+k].a === v)))} />
    </div>
  );
}

// ───────── Соедини пары ─────────
const LINK_COLORS = ["#0A84FF", "#A55CF5", "#34C759", "#5AC8FA", "#5856D6", "#30B0C7", "#AF52DE", "#64D2FF"]; // без красного и оранжевого — их принимают за ошибку
function Pairs({ task }: { task: TaskData }) {
  const { t } = useT();
  const o = task.options;
  const p = useMemo(() => parse("pairs", task.content), [task.content]);
  const ck = useChecker(o, task.id);
  const [link, setLink] = useSlot<Record<number, number>>(task.id, "link", {}); // левый → индекс правого
  const [sel, setSel] = useState<number | null>(null);
  // учителю: навёл или нажал на левую карточку — её пара справа мягко подсвечивается зелёным (без текста-подсказки)
  const key = useKey();
  const [hov, setHov] = useState<number | null>(null);
  if (p.kind !== "pairs") return null;
  const hint = key ? sel ?? hov : null;
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
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov((h) => (h === i ? null : h))} onFocus={() => setHov(i)} onBlur={() => setHov((h) => (h === i ? null : h))}
              onClick={() => setSel(sel === i ? null : i)}>{pr[0]}</button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {right.map((ri) => done.includes(ri) ? null : (
            <button key={ri} type="button" className={`tk-card ${hint === ri ? "keyhit" : ""}`}
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
  const [hover, setHover] = useState<string | null>(null);
  const key = useKey(); // учителю: нажать или навести на слово — нужная колонка подсвечивается зелёным
  const buckets: { name: string; words: string[]; pic?: string }[] = p.kind === "columns" ? p.cols.map((c) => ({ name: c.name, words: c.words })) : p.kind === "words" ? p.items.map((x, i) => ({ name: x.word, words: [x.word], pic: o.pics?.[i] })) : [];
  const all = shuffle(buckets.flatMap((b) => b.words), task.id);
  const truth = (w: string) => buckets.findIndex((b) => b.words.includes(w));
  const errors = all.filter((w) => place[w] !== truth(w)).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="tk-bank">
        {all.filter((w) => place[w] === undefined).map((w) => (
          <button key={w} type="button" className={`tk-chip ${pick === w ? "on" : ""}`} onClick={() => setPick(pick === w ? null : w)}
            onMouseEnter={() => setHover(w)} onMouseLeave={() => setHover(null)}
            draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", w)}>{w}</button>
        ))}
        {all.every((w) => place[w] !== undefined) && <span className="hint">{t("tk.allPlaced")}</span>}
      </div>
      <div className={pictures ? "tk-pics" : "tk-cols"}>
        {buckets.map((b, bi) => {
          const here = all.filter((w) => place[w] === bi);
          const drop = (w: string) => { setPlace((x) => ({ ...x, [w]: bi })); setPick(null); if (ck.instant) ck.bump(w); };
          return (
            <div key={bi} className={`tk-col ${key && (hover ?? pick) !== null && truth((hover ?? pick)!) === bi ? "keyhit" : ""}`} onClick={() => pick && drop(pick)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(e.dataTransfer.getData("text/plain")); }}>
              {pictures ? (b.pic ? <img src={b.pic} alt="" className="tk-pic" /> : <div className="tk-pic empty"><Icon name="image" /></div>) : <div className="tk-colh">{b.name}</div>}
              {pictures && <Key text={b.name} />}
              <div className="flex min-h-[38px] flex-wrap gap-1.5">
                {here.map((w) => (
                  <button key={w} type="button" className={`tk-chip ${ck.checked ? (truth(w) === bi ? "ok" : "bad") : ""}`} onMouseEnter={() => setHover(w)} onMouseLeave={() => setHover(null)} onClick={(e) => { e.stopPropagation(); setPlace((x) => { const y = { ...x }; delete y[w]; return y; }); }}>{w}</button>
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
              {ck.reveal(String(i)) && m === "bad" ? <span className="tk-ans self-start">{it.toks.join(letters ? "" : " ")}</span> : <Key text={it.toks.join(letters ? "" : " ")} mode="block" />}
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
          <span className="grow">{items[v]}</span><Key text={String(v + 1)} pre="№" />
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
            <div className="mb-1.5"><Num i={i} o={o} /> {it.q} {it.key && <span className="tk-hint tk-kw" title={t("tk.keyWord")}>{it.key}</span>}</div>
            <Fixable tid={task.id} k={String(i)} src={val[i] ?? ""} rows={2}>
            <span className="flex items-center gap-2"><input className={`input tk-line ${m ?? ""}`} value={val[i] ?? ""} onChange={(e) => setVal((x) => ({ ...x, [i]: e.target.value }))} onBlur={(e) => { if (ck.instant && e.target.value) { ck.bump(String(i)); ck.record(String(i), e.target.value, same(e.target.value, it.answers)); } }} aria-label={`answer ${i + 1}`} />
            {it.answers.length > 0 && <Tries hist={ck.hist[String(i)]} answer={it.answers.join(" / ")} tid={task.id} k={String(i)} noKey />}</span>
            </Fixable>
            {m === "bad" && <span className="small text-text2">{t("tk.teacherWillSee")}</span>}
            {ck.reveal(String(i)) && m === "bad" ? <span className="tk-ans">{it.answers[0]}</span> : <Key text={it.answers.join(" / ")} mode="block" />}
          </div>
        );
      })}
      <CheckBar ck={ck} errors={errors} total={p.items.filter((x) => x.answers.length).length} onCheck={() => p.items.forEach((it, i) => it.answers.length && val[i] && ck.record(String(i), val[i], same(val[i], it.answers)))} onReset={() => setVal((x) => Object.fromEntries(Object.entries(x).filter(([k, v]) => same(v, p.items[+k].answers))))} />
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
              {g === "wrong" && ck.reveal(String(i)) ? <span className="tk-ans">{s}</span> : <Key text={s} mode="block" />}
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
  // направление ввода: держится, пока ученик сам его не сменит (клик по той же клетке, стрелки, клик по вопросу)
  const [dir, setDir] = useState<"across" | "down">("across");
  const [at, setAt] = useState<string | null>(null);
  const dirRef = useRef(dir); dirRef.current = dir;
  const backRef = useRef<(k: string) => void>(() => {});
  const keyC = useKey();
  if (!cw) return <p className="hint">{t("tk.empty")}</p>;
  const nums = new Map(cw.words.map((w) => [`${w.row},${w.col}`, w.n]));
  const cellsOf = (w: (typeof cw.words)[number]) => w.word.split("").map((_, i) => `${w.across ? w.row : w.row + i},${w.across ? w.col + i : w.col}`);
  const wordOk = (w: (typeof cw.words)[number]) => w.word.split("").every((ch, i) => (cell[cellsOf(w)[i]] ?? "").toUpperCase() === ch);
  const errors = cw.words.filter((w) => !wordOk(w)).length;
  const okCells = new Set(cw.words.filter(wordOk).flatMap(cellsOf));
  // в каких направлениях есть слово через клетку
  const dirs = new Map<string, Set<"across" | "down">>();
  for (const w of cw.words) for (const k of cellsOf(w)) { const x = dirs.get(k) ?? new Set(); x.add(w.across ? "across" : "down"); dirs.set(k, x); }
  const has = (k: string) => !!refs.current[k];
  const step = (k: string, d: "across" | "down", by: 1 | -1) => { const [r, c] = k.split(",").map(Number); return d === "across" ? `${r},${c + by}` : `${r + by},${c}`; };
  const go = (k: string) => refs.current[k]?.focus();
  // текущее слово — подсветка клеток
  const active = at ? cw.words.find((w) => (w.across ? "across" : "down") === dir && cellsOf(w).includes(at)) ?? cw.words.find((w) => cellsOf(w).includes(at)) : null;
  const inWord = new Set(active ? cellsOf(active) : []);
  const onFocus = (k: string) => {
    setAt(k);
    const ds = dirs.get(k);
    if (ds && !ds.has(dirRef.current)) setDir([...ds][0]); // в клетке есть слово только другого направления
  };
  // Backspace: стереть букву и перейти на предыдущую клетку (в пустой клетке — стереть предыдущую)
  const back = (k: string) => {
    const d = dirRef.current, prev = step(k, d, -1);
    if (cell[k]) { setCell((x) => ({ ...x, [k]: "" })); if (has(prev)) go(prev); return; }
    if (has(prev)) { setCell((x) => ({ ...x, [prev]: "" })); go(prev); }
  };
  backRef.current = back;
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, k: string) => {
    if (e.key === "Backspace") { e.preventDefault(); back(k); return; }
    const arrows: Record<string, ["across" | "down", 1 | -1]> = { ArrowRight: ["across", 1], ArrowLeft: ["across", -1], ArrowDown: ["down", 1], ArrowUp: ["down", -1] };
    const a = arrows[e.key];
    if (a) { e.preventDefault(); setDir(a[0]); const n = step(k, a[0], a[1]); if (has(n)) go(n); }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="tk-cw" style={{ gridTemplateColumns: `repeat(${cw.cols}, 34px)` }}>
        {cw.grid.flatMap((row, r) => row.map((ch, c) => {
          const k = `${r},${c}`;
          if (!ch) return <div key={k} />;
          const m = ck.checked && cell[k] ? (okCells.has(k) ? "ok" : cell[k].toUpperCase() === ch ? "" : "bad") : "";
          return (
            <div key={k} className={`tk-cell ${inWord.has(k) ? "inword" : ""}`}>
              {nums.has(k) && <span className="tk-cn">{nums.get(k)}</span>}
              {keyC && !cell[k] && <span className="tk-cw-key" aria-hidden>{ch}</span>}
              <input ref={(el) => {
                  refs.current[k] = el;
                  // телефон: Backspace в пустой клетке приходит только как beforeinput
                  if (el && !el.dataset.bs) { el.dataset.bs = "1"; el.addEventListener("beforeinput", (ev) => { if ((ev as InputEvent).inputType === "deleteContentBackward" && !el.value) { ev.preventDefault(); el.dispatchEvent(new CustomEvent("cw-back")); } }); el.addEventListener("cw-back", () => backRef.current(k)); }
                }}
                maxLength={1} className={m} value={cell[k] ?? ""} aria-label={`cell ${r + 1}-${c + 1}`} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                onFocus={() => onFocus(k)}
                onMouseDown={() => { const ds = dirs.get(k); if (at === k && ds && ds.size > 1) setDir((d) => (d === "across" ? "down" : "across")); }}
                onKeyDown={(e) => onKey(e, k)}
                onChange={(e) => {
                  const v = e.target.value.slice(-1);
                  setCell((x) => ({ ...x, [k]: v }));
                  if (v) { const n = step(k, dirRef.current, 1); if (has(n)) go(n); }
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
              <button type="button" key={w.n + w.word} className={`tk-clue small ${ck.checked ? (wordOk(w) ? "text-ok" : "") : ""} ${active === w ? "on" : ""}`} onClick={() => { setDir(w.across ? "across" : "down"); const first = cellsOf(w).find((x) => !cell[x]) ?? cellsOf(w)[0]; go(first); }}><b>{w.n}.</b> {w.clue || "—"} ({w.word.length})</button>
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

/** Картинка: размер (s — поменьше, l — во всю ширину), по нажатию — увеличить на весь экран. */
function Pic({ im, cls = "" }: { im: { src: string; caption?: string; size?: "s" | "l" }; cls?: string }) {
  const [zoom, setZoom] = useState(false);
  return (
    <>
      <img src={im.src} alt={im.caption ?? ""} className={`tk-img ${im.size ? `sz-${im.size}` : ""} ${cls}`} onClick={() => setZoom(true)} />
      {zoom && <div className="tk-zoom" role="dialog" aria-modal onClick={() => setZoom(false)}><img src={im.src} alt={im.caption ?? ""} /><button type="button" className="tk-zoom-x" aria-label="close"><Icon name="close" /></button></div>}
    </>
  );
}

function Images({ o }: { o: TaskOptions }) {
  const { t } = useT();
  const imgs = o.images ?? [];
  const [i, setI] = useState(0);
  useEffect(() => { for (const im of o.images ?? []) { const x = new Image(); x.src = im.src; } }, [o.images]);
  if (!imgs.length) return <div className="tk-empty"><Icon name="image" />{t("tk.noImages")}</div>;
  if (o.layout === "stack" || imgs.length === 1)
    return <div className="flex flex-col gap-3">{imgs.map((im, k) => <figure key={k} className="m-0"><Pic im={im} />{im.caption && <figcaption className="small muted mt-1">{im.caption}</figcaption>}</figure>)}</div>;
  const im = imgs[Math.min(i, imgs.length - 1)];
  return (
    <figure className="m-0">
      <div className="relative">
        <Pic key={`${i}-${im.src}`} im={im} />
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
    case "textorder": return <div className="flex flex-col gap-3">{(o.images?.length ?? 0) > 0 && <Images o={o} />}<Order key={task.content} task={task} /></div>;
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
    case "text": return <div>{o.images?.[0] && <Pic im={o.images[0]} cls="mb-3" />}{o.markable ? <MarkWords task={task} /> : <Rich text={task.content} />}</div>;
    case "info": return <Rich text={task.content} />;
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
          {/* по умолчанию — запись ответа (монолог); диалог с ИИ — только если учитель включил */}
          {o.aiTalk ? <AiTalk task={task} /> : <Recorder task={task} />}
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
          <Fixable tid={task.id} k={String(i)} src={val[i] ?? ""} rows={4}><textarea className="textarea" aria-label={q} value={val[i] ?? ""} onChange={(e) => setVal((x) => ({ ...x, [i]: e.target.value }))} /></Fixable></div>
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
      <Fixable tid={task.id} k="text" src={v} rows={6}>
        <textarea className="textarea" style={{ minHeight: 180 }} value={v} onChange={(e) => setV(e.target.value)} placeholder={t("tk.essayPh")} aria-label={t("tk.essayPh")} />
        <span className={`small ${lim && words > lim ? "text-bad" : "text-text3"}`}>{t("tk.words", { n: words })}{lim ? ` / ${lim}` : ""} · {t("tk.teacherChecks")}</span>
      </Fixable>
    </div>
  );
}

/** «Исправленная версия» письменного ответа (эссе, открытый ответ, перефраз, перевод).
 *  Учитель включает бегунок: слева текст ученика, справа — его копия, которую учитель правит или дописывает комментарии;
 *  «Отправить ученику» — и только тогда у ученика появляется такой же бегунок с двумя колонками.
 *  Что учитель поменял, подсвечено: у ученика в его тексте — что исправлено, справа — как стало. */
const countOf = (x: string) => ({ c: x.length, w: x.trim() ? x.trim().split(/\s+/).length : 0 });
function FixMarks({ a, b, side }: { a: string; b: string; side: "src" | "fix" }) {
  const parts = wordDiff(a, b);
  return (
    <div className="tk-fixtext">
      {parts.map((p, i) => p.k === "same" ? <span key={i}>{p.t}</span>
        : side === "src" ? (p.k === "del" ? <mark key={i} className="tk-fix-was">{p.t}</mark> : null)
        : (p.k === "add" ? <mark key={i} className="tk-fix-now">{p.t}</mark> : null))}
    </div>
  );
}
function FixCol({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  const { t } = useT();
  const n = countOf(text);
  return (
    <div className="tk-fixcol">
      <div className="tk-fixhead"><b>{title}</b><span>{t("tk.chars", { n: n.c })}</span><span>{t("tk.wordsN", { n: n.w })}</span></div>
      {children}
    </div>
  );
}
function Fixable({ tid, k, src, rows = 6, children }: { tid: string; k: string; src: string; rows?: number; children: React.ReactNode }) {
  const { t } = useT();
  const role = useTaskRole();
  const [corr, setCorr] = useSlot<Record<string, string>>(tid, "corr", {}); // черновик учителя — ученик его не видит
  const [sent, setSent] = useSlot<Record<string, string>>(tid, "corrSent", {}); // отправленная ученику версия
  const draft = corr[k], shown = sent[k];
  const teacher = role === "teacher";
  const has = teacher ? !!src.trim() || draft !== undefined : shown !== undefined;
  const [on, setOn] = useState(() => (teacher ? draft !== undefined : shown !== undefined));
  // учитель отправил проверку, пока ученик в уроке, — у него сразу открывается исправленная версия
  const seen = useRef(shown);
  useEffect(() => { if (!teacher && shown !== undefined && shown !== seen.current) { seen.current = shown; setOn(true); } }, [shown, teacher]);
  if (role === "guest" || !has) return <>{children}</>;
  const toggle = (
    <label className="tk-fixswitch">
      <span>{t("tk.fixToggle")}</span>
      <span className="switch"><input type="checkbox" checked={on} onChange={(e) => { const v = e.target.checked; setOn(v); if (v && teacher && draft === undefined) setCorr((c) => ({ ...c, [k]: src })); }} /><span /></span>
    </label>
  );
  if (!on) return <>{children}{toggle}</>;
  const right = teacher ? draft ?? src : shown ?? "";
  const changed = teacher && draft !== undefined && draft !== shown;
  return (
    <>
      {toggle}
      <div className="tk-fix">
        <FixCol title={teacher ? t("tk.fixStudent") : t("tk.fixMine")} text={src}><FixMarks a={src} b={right} side="src" /></FixCol>
        <FixCol title={t("tk.fixTeacher")} text={right}>
          {teacher ? (
            <>
              <textarea className="textarea tk-fixedit" rows={rows} value={right} placeholder={t("tk.fixPh")} aria-label={t("tk.fixTeacher")} onChange={(e) => setCorr((c) => ({ ...c, [k]: e.target.value }))} />
              {right !== src && <FixMarks a={src} b={right} side="fix" />}
            </>
          ) : <FixMarks a={src} b={right} side="fix" />}
        </FixCol>
      </div>
      {teacher && (
        <div className="tk-fixbar">
          {shown !== undefined && !changed && <span className="small text-ok">✓ {t("tk.fixSent")}</span>}
          {changed && <button type="button" className="btn primary sm" onClick={() => setSent((x) => ({ ...x, [k]: right }))}>{shown === undefined ? t("tk.fixSend") : t("tk.fixResend")}</button>}
        </div>
      )}
    </>
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
  const role = useTaskRole();
  const h = task.options.help;
  const list = (x?: string) => (x ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const vocab = list(h?.vocab), grammar = list(h?.grammar);
  if (!vocab.length && !grammar.length) return null;
  if (h?.hidden && role === "student") return null; // скрыты учителем: остаются в задании, ученик их не видит
  return (
    <div className={`tk-help ${h?.hidden ? "off" : ""}`}>
      <button type="button" className="tk-help-btn" aria-expanded={open} onClick={() => setOpen((x) => !x)}><Icon name={open ? "eyeoff" : "eye"} size="sm" />{t("tk.help")}{h?.hidden && <span className="tk-help-off">· {t("tk.helpHidden")}</span>}</button>
      {open && (
        <div className="tk-help-box">
          {vocab.length > 0 && <div><b>{t("tk.helpVocab")}</b><ul className="tk-help-v">{vocab.map((x, i) => <li key={i}><Inl text={x} /></li>)}</ul></div>}
          {grammar.length > 0 && <div><b>{t("tk.helpGrammar")}</b><ul className="tk-help-g">{grammar.map((x, i) => <li key={i}><Inl text={x} /></li>)}</ul></div>}
        </div>
      )}
    </div>
  );
}

/** Ответы для учителя: ученику не приходят с сервера; учитель раскрывает их сам. */
function TeacherKey({ task }: { task: TaskData }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const role = useTaskRole();
  const k = task.options.teacherKey?.trim();
  if (!k || role === "student") return null;
  return (
    <div className="tk-tkey">
      <button type="button" className="tk-tkey-btn" aria-expanded={open} onClick={() => setOpen((x) => !x)}><Icon name={open ? "eyeoff" : "eye"} size="sm" />{open ? t("tk.keyHide") : t("tk.keyShow")}</button>
      {open && <div className="tk-tkey-box"><Rich text={k} /></div>}
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
        <TeacherKey task={task} />
      </article>
    );
  // пояснение посреди урока: мягкий фон, без номера, заголовок — по желанию
  if (task.type === "info")
    return (
      <article className="tk tk-info">
        {(task.title.trim() || actions) && <header className="tk-head"><h3 className="tk-title tk-info-t"><TitleText text={task.title} /></h3>{actions}</header>}
        <Rich text={task.content} />
        <TeacherKey task={task} />
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
      <TeacherKey task={task} />
    </article>
  );
}
