"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { addSpeakingToLesson, aiScore, assignExtraWS, deletePlacement, finalizePlacement, saveReview, sendResultTelegram, setShowResult } from "@/lib/placement/actions";
import { transcribe } from "../ai/audio";
import type { PlScore } from "@/lib/ai/tasks";
import { BASE, finalHint, PL_LEVELS, scoreStep, STEPS, type PLevel, type Summary } from "@/lib/placement/engine";
import type { ReviewData } from "@/lib/placement/review";
import type { Rubric } from "@/lib/placement/bank";
import { useRun } from "../courses/useRun";
import { Icon } from "../Icon";
import { fmtSec } from "./PlacementAnswers";
import { Block, ReviewInsights } from "./ReviewInsights";
import { levelNote } from "@/lib/placement/level-notes";
import type { DictKey } from "@/lib/i18n/dict";

type Marks = Record<string, number>;
export type ReviewProps = {
  id: string; mode: string; status: string; level: string | null; showResult: boolean; teen?: boolean; tgSent?: string | null;
  sm: Summary; d: ReviewData; review: { writing?: Record<string, unknown>; speaking?: Record<string, unknown>; points?: boolean[]; comment?: string; wNote?: string; sNote?: string; wc?: Record<string, string>; sc?: Record<string, string>; lesson?: { level: string; marks: Record<string, unknown> } | null; ai?: Partial<Record<"writing" | "speaking", PlScore & { level?: string; transcripts?: string[] }>> };
  lessonQs: { level: string; questions: string[] }[]; // говорение на уроке: вопросы уровнем выше и ниже
  rubrics: { writing: Rubric[]; speaking: Rubric[] }; howTo: string; sublevels: string; total: string;
  parts?: string[]; dates?: Record<string, string>; // разделы теста и даты, когда каждый пройден
  base?: { sub: string; from: "test" | "teacher" } | null; // грамматику не проверяли: от какого уровня шли остальные разделы
  who?: string; reveal?: string[]; // имя ученика (для PDF таблицы и списков) и скрипты, открытые ученику
};
const nums = (m?: Record<string, unknown>): Marks => Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => typeof v === "number")) as Marks;
const prevLevel = (l: string) => PL_LEVELS[Math.max(0, PL_LEVELS.indexOf(l as PLevel) - 1)];

const pct = (r?: [number, number]) => (r && r[1] ? Math.round((r[0] / r[1]) * 100) : null);
const cell = (r?: [number, number]) => (r && r[1] ? <><b>{pct(r)}%</b> <span className="muted">{r[0]}/{r[1]}</span></> : <span className="muted">—</span>);

/** Проверка вводного теста учителем: таблица по навыкам, оценки письма и говорения по критериям, итог. */
// На какой экзамен Cambridge опираются критерии уровня задания (для A1 у взрослых экзамена нет — шкала CEFR)
const EXAM: Record<string, string> = { A1: "шкала CEFR A1", A2: "A2 Key", B1: "B1 Preliminary", B2: "B2 First", C1: "C1 Advanced" };
const EXAM_TEEN: Record<string, string> = { A1: "A1 Movers", A2: "A2 Key for Schools", B1: "B1 Preliminary for Schools", B2: "B2 First for Schools", C1: "C1 Advanced" };

/** Комментарий к критерию: поле всегда под шкалой 0–3. Заполнил — уйдёт в отчёт; пусто — ничего не выводится. */
function CritNote({ v, onChange }: { v: string; onChange: (v: string) => void }) {
  const { t } = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  // высота по тексту: сохранённый комментарий виден целиком
  useEffect(() => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }, [v]);
  return <textarea ref={ref} className="textarea critnote" rows={1} value={v} onChange={(e) => onChange(e.target.value)} placeholder={t("pl.critNotePh")} aria-label={t("pl.critNote")} />;
}

export function PlacementReview(p: ReviewProps) {
  const { t, lang } = useT();
  const { run, pending, error } = useRun();
  const [w, setW] = useState<Marks>(nums(p.review.writing));
  const [s, setS] = useState<Marks>(nums(p.review.speaking));
  // ИИ-проверка: баллы-подсказки по критериям уровня задания (учитель правит), обоснования и вывод
  const [ai, setAi] = useState(p.review.ai ?? {});
  const [aiBusy, setAiBusy] = useState<"" | "writing" | "speaking">("");
  const [aiErr, setAiErr] = useState<string | null>(null);
  const runAi = async (kind: "writing" | "speaking") => {
    const cur = kind === "writing" ? w : s;
    if (Object.keys(cur).length && !confirm(t("pl.aiOverwrite"))) return;
    setAiBusy(kind); setAiErr(null);
    try {
      let tr: string[] = [];
      if (kind === "speaking") {
        // записи → WAV в браузере → распознавание речи; пустая запись — пустая строка
        tr = await Promise.all((p.d.speaking?.questions ?? []).map(async (q) => {
          if (!q.url) return "";
          const blob = await (await fetch(q.url)).blob();
          return transcribe(blob).catch((e: Error) => { throw e; });
        }));
      }
      const r = await aiScore(p.id, kind, tr);
      if (!r.ok || !r.ai) { const c = (r as { error?: string }).error; setAiErr(t(`pl.aiErr.${c === "off" || c === "limit" || c === "tariff" ? c : "fail"}` as DictKey)); return; }
      const got = Object.fromEntries(Object.entries(r.ai.scores).filter(([, v]) => typeof v === "number")) as Marks;
      if (kind === "writing") setW((x) => ({ ...x, ...got })); else setS((x) => ({ ...x, ...got }));
      setAi((x) => ({ ...x, [kind]: { ...r.ai!, transcripts: tr } }));
    } catch (e) {
      const c = (e as Error).message;
      setAiErr(t(`pl.aiErr.${c === "off" || c === "limit" || c === "tariff" ? c : "fail"}` as DictKey));
    } finally { setAiBusy(""); }
  };
  const [pts, setPts] = useState<boolean[]>(p.review.points ?? []);
  const [comment, setComment] = useState(p.review.comment ?? "");
  // почему поставлены такие баллы — ремарка учителя к письму и к говорению
  const [wNote, setWNote] = useState(p.review.wNote ?? "");
  const [sNote, setSNote] = useState(p.review.sNote ?? "");
  // комментарий к каждому критерию: почему такой балл (ученик увидит его в отчёте под оценкой)
  const [wc, setWc] = useState<Record<string, string>>(p.review.wc ?? {});
  const [sc, setSc] = useState<Record<string, string>>(p.review.sc ?? {});
  const [lesson, setLesson] = useState<{ level: string; marks: Marks } | null>(p.review.lesson ? { level: p.review.lesson.level, marks: nums(p.review.lesson.marks) } : null);
  const [lessonMsg, setLessonMsg] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = setTimeout(() => { void saveReview(p.id, { writing: w, speaking: s, points: pts, comment, lesson, wNote, sNote, wc, sc }); }, 800);
    return () => clearTimeout(h);
  }, [w, s, pts, comment, lesson, wNote, sNote, wc, sc, p.id]);
  const noteBox = (id: string, v: string, set: (x: string) => void) => (
    <div className="field plnote"><label htmlFor={id}>{t("pl.scoreNote")}</label>
      <textarea id={id} className="textarea" rows={3} value={v} onChange={(e) => set(e.target.value)} placeholder={t("pl.scoreNotePh")} /></div>
  );

  const wHint = p.d.writing ? scoreStep(p.rubrics.writing.map((c) => w[c.id]), p.d.writing.level as PLevel, w.task) : null;
  const sTask = p.d.speaking ? scoreStep(p.rubrics.speaking.map((c) => s[c.id]), p.d.speaking.level as PLevel) : null;
  // оценка говорения на уроке (вопросы уровнем выше/ниже) — самая свежая, поэтому идёт в итог, если заполнена полностью
  const sLesson = lesson ? scoreStep(p.rubrics.speaking.map((c) => lesson.marks[c.id]), lesson.level as PLevel) : null;
  const sHint = sLesson ?? sTask;
  const has = (s: string) => !p.parts || p.parts.includes(s);
  const hint = finalHint([has("core") ? p.sm.coreStep : null, p.sm.vstep, p.sm.readStep, p.sm.listenStep, wHint, sHint]);
  const [lvl, setLvl] = useState(p.level ?? (hint !== null ? STEPS[hint] : ""));
  const L = ["A1", "A2", "B1", "B2", "C1"].filter((l) => p.sm.core[l] || p.sm.reading[l] || p.sm.listening[l]);
  const waiting = p.status === "new" || p.status === "active";

  const sm = p.sm;
  // письмо и говорение в таблице «Результаты по навыкам»: сумма баллов учителя из максимума на уровне задания
  // (и дополнительные задания уровнем выше/ниже, и говорение на уроке) — когда оценены все критерии
  const scoreOf = (list: Rubric[], m: Marks): [number, number] | null => (list.every((c) => typeof m[c.id] === "number") ? [list.reduce((a, c) => a + (m[c.id] ?? 0), 0), list.length * 3] : null);
  const wsRows: Record<"writing" | "speaking", Record<string, [number, number]>> = { writing: {}, speaking: {} };
  for (const kind of ["writing", "speaking"] as const) {
    const list = kind === "writing" ? p.rubrics.writing : p.rubrics.speaking;
    const add = (lv: string | undefined, m: Marks) => { const r = lv ? scoreOf(list, m) : null; if (r && lv) wsRows[kind][lv] = r; };
    for (const x of (p.d.prev ?? []).filter((y) => y.kind === kind)) add(x.level, nums(x.marks));
    add(p.d[kind]?.level, kind === "writing" ? w : s);
    if (kind === "speaking" && lesson) add(lesson.level, lesson.marks);
  }
  // активное время = всё время в разделе минус перерывы; перерывы показываем отдельно
  const idle: Record<string, number> = { ...(p.d.idle ?? {}) }, pauses: Record<string, number> = { ...(p.d.pauses ?? {}) };
  // старые прохождения без отметок активности: в грамматике и лексике время каждого ответа известно — по нему и считаем
  for (const [k, vocab] of [["core", false], ["vocab", true]] as const) {
    if (idle[k] || !p.d.times[k]) continue;
    const work = p.d.core.filter((x) => !!x.vocab === vocab && x.ms !== null).reduce((a, x) => a + Math.min(x.ms!, 8 * 60e3), 0);
    if (work && p.d.times[k] - work > 8 * 60e3) { idle[k] = p.d.times[k] - work; pauses[k] = 1; }
  }
  const tm = Object.fromEntries(Object.entries(p.d.times).map(([k, v]) => [k, Math.max(0, v - (idle[k] ?? 0))]));

  const descr = (c: Rubric, level: string, v: number) =>
    v === 3 ? `${t("pl.sc3")}: ${c.levels[level] ?? ""}` : v === 2 ? t("pl.sc2") : v === 1 ? (level === "A1" ? t("pl.sc1A1") : `${t("pl.sc1", { l: prevLevel(level) })}: ${c.levels[prevLevel(level)] ?? ""}`) : t("pl.sc0");
  const rubric = (title: string, list: Rubric[], m: Marks, set: (x: Marks) => void, h: number | null, level: string, aiKind?: "writing" | "speaking") => {
    const A = aiKind ? ai[aiKind] : undefined;
    // выбрали балл — в комментарий сразу идёт его расшифровка; учитель дописывает своё. Свой текст не затираем:
    // заменяем, только если поле пустое или в нём расшифровка прежнего балла
    const pick = (c: Rubric, v: number) => {
      set({ ...m, [c.id]: v });
      if (!aiKind) return;
      const setN = aiKind === "writing" ? setWc : setSc;
      setN((x) => { const cur = (x[c.id] ?? "").trim(), old = typeof m[c.id] === "number" ? descr(c, level, m[c.id]) : ""; return !cur || cur === old ? { ...x, [c.id]: descr(c, level, v) } : x; });
    };
    const done = list.filter((c) => typeof m[c.id] === "number");
    const sum = done.reduce((a, c) => a + m[c.id], 0);
    return (
      <div className="plrub">
        <p className="small muted m-0">{t("pl.scRemind", { l: level, ex: (p.teen ? EXAM_TEEN : EXAM)[level] ?? `CEFR ${level}` })}</p>
        {aiKind && (
          <div className="plai">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn secondary sm" disabled={!!aiBusy} onClick={() => runAi(aiKind)}><Icon name="spark" size="sm" />{aiBusy === aiKind ? t(aiKind === "speaking" ? "pl.aiListening" : "pl.aiChecking") : A ? t("pl.aiAgain") : t("pl.aiCheck")}</button>
              <span className="small muted grow">{t(aiKind === "speaking" ? "pl.aiHintS" : "pl.aiHintW")}</span>
            </div>
            {aiErr && aiBusy === "" && <div className="small text-bad">{aiErr}</div>}
            {A?.summary && <div className="small"><b>{t("pl.aiSummary")}:</b> {A.summary}</div>}
            {aiKind === "speaking" && A?.transcripts?.some(Boolean) && <details><summary className="small">{t("pl.aiTranscript")}</summary><ol className="small mt-1 mb-0">{A.transcripts.map((x, i) => <li key={i}>{x || "—"}</li>)}</ol></details>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2"><b className="grow">{t("pl.scTitle", { l: level })}</b>
          {done.length === list.length ? <span className="pill">{t("pl.scSum", { s: sum, m: list.length * 3 })} → {h !== null ? STEPS[h] : "—"}</span> : <span className="small muted">{t("pl.scLeft", { n: list.length - done.length })}</span>}
        </div>
        {list.map((c) => (
          <div key={c.id} className="plcrit2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="small font-semibold grow">{c.name_ru}{A && typeof A.scores?.[c.id] === "number" && <span className="pill violet ml-2">{t("pl.aiGave", { n: A.scores[c.id] as number })}</span>}</span>
              <div className="plscore" role="radiogroup" aria-label={`${title}: ${c.name_ru}`}>
                {[0, 1, 2, 3].map((v) => <button key={v} type="button" role="radio" aria-checked={m[c.id] === v} className={m[c.id] === v ? "on" : ""} title={descr(c, level, v)} onClick={() => pick(c, v)}>{v}</button>)}
              </div>
            </div>
            {A?.why?.[c.id] && <div className="small plai-why"><Icon name="spark" size="sm" /> {A.why[c.id]}</div>}
            {/* шкала видна сразу: что значит каждый балл для этого уровня; строку можно нажать вместо кнопки */}
            <div className="plscale">
              {[3, 2, 1, 0].map((v) => (
                <button key={v} type="button" className={`plscrow ${m[c.id] === v ? "on" : ""}`} onClick={() => pick(c, v)}>
                  <b>{v}</b><span>{descr(c, level, v)}</span>
                </button>
              ))}
            </div>
            {/* комментарий к баллу — поле всегда под шкалой; пусто — в отчёт ничего не идёт */}
            {aiKind && <CritNote v={(aiKind === "writing" ? wc : sc)[c.id] ?? ""} onChange={(v) => (aiKind === "writing" ? setWc : setSc)((x) => ({ ...x, [c.id]: v }))} />}
          </div>
        ))}
        <details><summary className="small">{t("pl.scHow")}</summary><p className="small mt-2 mb-0">{p.total}</p></details>
      </div>
    );
  };

  // письмо и говорение: подсказка «дать задание уровнем выше/ниже» и кнопки (решение — за учителем)
  const median3 = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => typeof x === "number").sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  const extraBox = (kind: "writing" | "speaking", level: string, m: Marks, list: Rubric[]) => {
    const full = list.every((c) => typeof m[c.id] === "number");
    const sum = list.reduce((a, c) => a + (m[c.id] ?? 0), 0) * (12 / (list.length * 3));
    const others = median3([sm.coreStep, sm.vstep, kind === "writing" ? sm.readStep : sm.listenStep]);
    const li = PL_LEVELS.indexOf(level as PLevel), up = PL_LEVELS[li + 1], down = li > 0 ? PL_LEVELS[li - 1] : undefined;
    const sug = !full ? null : sum >= 11 && up ? "up" : (sum <= 4 || (kind === "writing" && typeof m.task === "number" && m.task <= 1)) && down ? "down" : null;
    const done = p.d.extra?.[kind];
    const give = (dir: number, to: string) => {
      if (!confirm(t(p.mode === "link" ? "pl.extraConfirmGuest" : "pl.extraConfirm", { k: t(`pl.part.${kind}` as DictKey).toLowerCase(), l: to }))) return;
      run(() => assignExtraWS(p.id, kind, dir));
    };
    return (
      <div className="plextra">
        {sug === "up" && <p className="m-0"><b>{t("pl.extraUpT")}</b> {t("pl.extraUp", { s: Math.round(sum), l: level, n: up! })}{others !== null && others > BASE[level as PLevel] + 1 ? ` ${t("pl.extraOthers", { o: STEPS[others] })}` : ""}</p>}
        {sug === "down" && <p className="m-0"><b>{t("pl.extraDownT")}</b> {t("pl.extraDown", { s: Math.round(sum), n: down! })}</p>}
        {done ? <p className="small muted m-0">{t(waiting ? "pl.extraWaiting" : "pl.extraDone", { d: t(done > 0 ? "pl.extraDirUp" : "pl.extraDirDown") })}</p> : !waiting && (
          <div className="flex flex-wrap gap-2">
            {up && <button type="button" className={`btn sm ${sug === "up" ? "primary" : "secondary"}`} disabled={pending} onClick={() => give(1, up)}><Icon name="right" size="sm" />{t("pl.extraGive", { l: up })}</button>}
            {down && <button type="button" className={`btn sm ${sug === "down" ? "primary" : "secondary"}`} disabled={pending} onClick={() => give(-1, down)}><Icon name="chevl" size="sm" />{t("pl.extraGive", { l: down })}</button>}
            <span className="small muted self-center">{t("pl.extraNote")}</span>
          </div>
        )}
      </div>
    );
  };
  const prevBlock = (kind: "writing" | "speaking") => (p.d.prev ?? []).filter((x) => x.kind === kind).map((x, i) => {
    const list = kind === "writing" ? p.rubrics.writing : p.rubrics.speaking;
    const full = list.every((c) => typeof x.marks[c.id] === "number");
    const st2 = full ? scoreStep(list.map((c) => x.marks[c.id]), x.level as PLevel, kind === "writing" ? x.marks.task : undefined) : null;
    return (
      <details key={i} className="plprevtask">
        <summary className="small"><b>{t("pl.prevTask", { l: x.level })}</b>{full && <> · {list.reduce((a, c) => a + (x.marks[c.id] ?? 0), 0)}/{list.length * 3} → {st2 !== null ? STEPS[st2] : "—"}</>}</summary>
        <div className="flex flex-col gap-2 mt-2">
          {kind === "writing" ? <><p className="m-0 small">{x.prompt}</p><div className="tpassage plpassage">{x.text || <span className="muted">{t("pl.noAnswer")}</span>}</div></>
            : x.questions.map((q, k) => <div key={k} className="flex flex-col gap-1"><span className="small"><b>{k + 1}.</b> {q.q}</span>{q.url ? <audio controls preload="none" src={q.url} className="w-full" /> : <span className="small muted">{t("pl.noRec")}</span>}</div>)}
        </div>
      </details>
    );
  });
  const addLesson = async (g: { level: string; questions: string[] }) => {
    const r = await addSpeakingToLesson(p.id, g.level, g.questions);
    if (r.ok) setLessonMsg(t("pl.lessonAdded", { d: new Date((r as { when?: string }).when ?? Date.now()).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) }));
    else setLessonMsg(t(r.error === "nolesson" ? "pl.lessonNone" : "pl.err.net"));
  };
  const lessonBox = () => p.lessonQs.length > 0 && (
    <details className="pllesson">
      <summary><Icon name="msg" size="sm" /> <b>{t("pl.lessonT")}</b> <span className="small muted">{t("pl.lessonHint")}</span></summary>
      <div className="pllessongrid mt-3">
        {p.lessonQs.map((g) => (
          <div key={g.level} className="pllessoncol">
            <b>{t("pl.lessonLevel", { l: g.level })}</b>
            <div className="small flex flex-col gap-1">{g.questions.map((q, i) => <div key={q}><b>{i + 1}.</b> {q}</div>)}</div>
            <div className="flex flex-wrap gap-2">
              {p.mode === "student" && <button type="button" className="btn secondary sm" disabled={pending} onClick={() => void addLesson(g)}><Icon name="plus" size="sm" />{t("pl.lessonAdd")}</button>}
              <button type="button" className="btn plain sm" onClick={() => { void navigator.clipboard?.writeText(g.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")); setLessonMsg(t("pl.copied")); }}><Icon name="copy" size="sm" />{t("pl.copy")}</button>
              <button type="button" className={`btn sm ${lesson?.level === g.level ? "primary" : "plain"}`} onClick={() => setLesson(lesson?.level === g.level ? null : { level: g.level, marks: {} })}>{t("pl.lessonRate")}</button>
            </div>
          </div>
        ))}
      </div>
      {lessonMsg && <p className="small m-0 mt-2">{lessonMsg}</p>}
      {lesson && <div className="mt-3">{rubric(t("pl.part.speaking"), p.rubrics.speaking, lesson.marks, (m) => setLesson({ level: lesson.level, marks: m }), sLesson, lesson.level)}<p className="small muted m-0 mt-1">{t("pl.lessonCounts")}</p></div>}
    </details>
  );

  return (
    <div className="flex flex-col gap-4">
      {waiting && <div className="alert flex flex-wrap items-center gap-2"><Icon name="hourglass" size="sm" /> <span className="grow">{t(p.mode === "self" ? "pl.inProgressSelf" : "pl.inProgress")}</span>{p.mode === "self" && <a className="btn primary sm" href={`/placement/${p.id}`}>{t("pl.continueSelf")}</a>}</div>}

      <ReviewInsights wsRows={wsRows} status={p.status} mode={p.mode} id={p.id} who={p.who ?? ""} sm={sm} d={p.d} reveal={p.reveal ?? []} has={has} hint={hint} tm={tm} idle={idle} dates={p.dates} base={p.base}
        steps={{ core: has("core") ? sm.coreStep : null, vocab: sm.vstep, reading: sm.readStep, listening: sm.listenStep, writing: wHint, speaking: sHint }}
        wsWaiting={{ writing: !!p.d.writing && wHint === null, speaking: !!p.d.speaking && sHint === null }}>
      {p.d.writing && (
        <Block title={t("pl.part.writing")} step={wHint !== null ? STEPS[wHint] : p.d.writing.level} time={tm.writing ? fmtSec(tm.writing) : null} idle={idle.writing ? fmtSec(idle.writing) : null} note={!waiting && wHint === null ? t("pr.wsPending") : null}>
          <div className="flex flex-col gap-3">
          <p className="small muted m-0">{t("pr.wsTaskLevel", { l: p.d.writing.level })}</p>
          <p className="m-0">{p.d.writing.prompt_en}</p>
          <div className="tpassage plpassage">{p.d.writing.text || <span className="muted">{t("pl.noAnswer")}</span>}</div>
          <div className="small muted">{t("pl.wordsOf", { n: p.d.writing.text.trim() ? p.d.writing.text.trim().split(/\s+/).length : 0, a: p.d.writing.min, b: p.d.writing.max })}</div>
          {p.d.writing.points.length > 0 && (
            <div className="plrub"><b className="small">{t("pl.pointsTitle")}</b>
              {p.d.writing.points.map((x, i) => <label key={i} className="flex items-center gap-2"><input type="checkbox" checked={!!pts[i]} onChange={(e) => setPts(p.d.writing!.points.map((_, j) => (j === i ? e.target.checked : !!pts[j])))} />{x}</label>)}
              <span className="small muted">{t("pl.pointsN", { a: pts.filter(Boolean).length, b: p.d.writing.points.length })}</span>
            </div>
          )}
          <details><summary className="small">{t("pl.expects")}</summary><ul className="small mt-2">{p.d.writing.expects.map((e) => <li key={e}>{e}</li>)}</ul></details>
          {rubric(t("pl.part.writing"), p.rubrics.writing, w, setW, wHint, p.d.writing.level, "writing")}
          {noteBox("pl-wnote", wNote, setWNote)}
          {extraBox("writing", p.d.writing.level, w, p.rubrics.writing)}
          {prevBlock("writing")}
          </div>
        </Block>
      )}

      {p.d.speaking && (
        <Block title={t("pl.part.speaking")} step={sTask !== null ? STEPS[sTask] : p.d.speaking.level} time={tm.speaking ? fmtSec(tm.speaking) : null} idle={idle.speaking ? fmtSec(idle.speaking) : null} note={!waiting && sTask === null ? t("pr.wsPending") : null}>
          <div className="flex flex-col gap-3">
          <p className="small muted m-0">{t("pr.wsTaskLevel", { l: p.d.speaking.level })}</p>
          {p.d.speaking.noMic && <div className="alert">{t("pl.noMicNote")}</div>}
          {p.d.speaking.questions.map((q, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span className="small"><b>{i + 1}.</b> {q.q}{q.rerec > 0 && <span className="muted"> · {t("pl.rerecN", { n: q.rerec })}</span>}{q.peek && <span className="pill orange ml-1">{t("pl.peeked")}</span>}</span>
              {q.url ? <audio controls preload="none" src={q.url} className="w-full" /> : <span className="small muted">{t("pl.noRec")}</span>}
            </div>
          ))}
          <details><summary className="small">{t("pl.expects")}</summary><ul className="small mt-2">{p.d.speaking.expects.map((e) => <li key={e}>{e}</li>)}</ul></details>
          {rubric(t("pl.part.speaking"), p.rubrics.speaking, s, setS, sTask, p.d.speaking.level, p.d.speaking.questions.some((q) => q.url) ? "speaking" : undefined)}
          {noteBox("pl-snote", sNote, setSNote)}
          {extraBox("speaking", p.d.speaking.level, s, p.rubrics.speaking)}
          {prevBlock("speaking")}
          {lessonBox()}
          </div>
        </Block>
      )}
      </ReviewInsights>

      {!waiting && (
        <section className="card flex flex-col gap-3">
          <h3 className="m-0">{t("pl.final")}</h3>
          <p className="small muted m-0">{t("pl.finalHint", { h: hint !== null ? STEPS[hint] : "—" })}</p>
          <details><summary className="small">{t("pl.howTo")}</summary><p className="small mt-2">{p.sublevels}</p><p className="small">{p.howTo}</p></details>
          <div className="flex flex-wrap items-end gap-2">
            <div className="field"><label htmlFor="pl-lvl">{t("pl.finalLevel")}</label>
              <select id="pl-lvl" className="select" value={lvl} onChange={(e) => setLvl(e.target.value)}><option value="">—</option>{STEPS.map((x) => <option key={x}>{x}</option>)}</select>
            </div>
            <button className="btn primary" disabled={pending || !lvl} onClick={() => run(() => finalizePlacement(p.id, lvl))}>{p.level ? t("pl.updateFinal") : t("pl.saveFinal")}</button>
            {p.level && <span className="pill green">✓ {p.level}</span>}
          </div>
          <div className="field">
            <div className="flex flex-wrap items-center gap-2"><label htmlFor="pl-c" className="grow">{t("pl.comment")}</label>
              {/* шаблон по уровню: что умеет, что подтянуть; темы с ошибками — первыми. Учитель правит под ученика */}
              {lvl && <button type="button" className="btn plain sm" onClick={() => { if (comment.trim() && !confirm(t("pl.tplReplace"))) return; setComment(levelNote(lvl, sm.groups.filter((g) => g.c < g.n).sort((a, b) => (b.n - b.c) - (a.n - a.c)).map((g) => g.name), lang === "en" ? "en" : "ru")); }}><Icon name="spark" size="sm" />{t("pl.tplIns", { l: lvl })}</button>}
            </div>
            <textarea id="pl-c" className="textarea" rows={comment ? Math.min(16, Math.max(4, comment.split("\n").length + Math.ceil(comment.length / 95))) : 3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("pl.commentPh")} />
          </div>
          {p.mode === "student" && (
            <label className="setting"><span>{t("pl.showToStudent")}<span className="small muted block">{p.level ? t("pl.showHint") : t("pl.showNeedLevel")}</span></span>
              <span className="switch"><input type="checkbox" checked={p.showResult} disabled={pending || !p.level} onChange={(e) => run(() => setShowResult(p.id, e.target.checked))} /><span /></span></label>
          )}
          {/* отчёт — когда всё проверено: тот же, что кнопкой вверху страницы */}
          {(p.status === "submitted" || p.status === "reviewed") && (
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/teacher/placement/${p.id}/report`} className="btn primary sm"><Icon name="dl" size="sm" />{t("pl.genReport")}</a>
              <span className="small muted">{t("pl.genReportHint")}</span>
            </div>
          )}
          {p.mode === "student" && p.level && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn tinted sm" disabled={pending} onClick={() => run(() => sendResultTelegram(p.id))}><Icon name="telegram" size="sm" />{t("pl.sendTg")}</button>
              <span className="small muted">{p.tgSent ? t("pl.tgSentAt", { d: p.tgSent }) : t("pl.sendTgHint")}</span>
            </div>
          )}
          {error && <div className="alert">{error}</div>}
        </section>
      )}
      {/* удаление — для пробных и случайных прохождений (например, ссылку открыл не тот человек); у ученика пропадёт и результат в кабинете */}
      <div className="flex flex-wrap items-center justify-end gap-2"><span className="small muted">{t("pl.deleteHint")}</span><button className="btn plain sm" onClick={() => { if (confirm(t("pl.delConfirm"))) run(() => deletePlacement(p.id), () => location.assign("/teacher/courses?tab=tests"), true); }}><Icon name="close" size="sm" />{t("pl.delete")}</button></div>
    </div>
  );
}
