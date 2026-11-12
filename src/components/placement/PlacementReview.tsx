"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { addSpeakingToLesson, aiScore, assignExtraWS, deletePlacement, finalizePlacement, saveReview, setShowResult } from "@/lib/placement/actions";
import { transcribe } from "../ai/audio";
import type { PlScore } from "@/lib/ai/tasks";
import { BASE, finalHint, PL_LEVELS, scoreStep, STEPS, type PLevel, type Summary } from "@/lib/placement/engine";
import type { ReviewData } from "@/lib/placement/review";
import type { Rubric } from "@/lib/placement/bank";
import { useRun } from "../courses/useRun";
import { Icon } from "../Icon";
import { fmtSec } from "./PlacementAnswers";
import type { DictKey } from "@/lib/i18n/dict";

type Marks = Record<string, number>;
export type ReviewProps = {
  id: string; mode: string; status: string; level: string | null; showResult: boolean; teen?: boolean;
  sm: Summary; d: ReviewData; review: { writing?: Record<string, unknown>; speaking?: Record<string, unknown>; points?: boolean[]; comment?: string; lesson?: { level: string; marks: Record<string, unknown> } | null; ai?: Partial<Record<"writing" | "speaking", PlScore & { level?: string; transcripts?: string[] }>> };
  lessonQs: { level: string; questions: string[] }[]; // говорение на уроке: вопросы уровнем выше и ниже
  rubrics: { writing: Rubric[]; speaking: Rubric[] }; howTo: string; sublevels: string; total: string;
};
const nums = (m?: Record<string, unknown>): Marks => Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => typeof v === "number")) as Marks;
const prevLevel = (l: string) => PL_LEVELS[Math.max(0, PL_LEVELS.indexOf(l as PLevel) - 1)];

const pct = (r?: [number, number]) => (r && r[1] ? Math.round((r[0] / r[1]) * 100) : null);
const cell = (r?: [number, number]) => (r && r[1] ? <><b>{pct(r)}%</b> <span className="muted">{r[0]}/{r[1]}</span></> : <span className="muted">—</span>);

/** Проверка вводного теста учителем: таблица по навыкам, оценки письма и говорения по критериям, итог. */
// На какой экзамен Cambridge опираются критерии уровня задания (для A1 у взрослых экзамена нет — шкала CEFR)
const EXAM: Record<string, string> = { A1: "шкала CEFR A1", A2: "A2 Key", B1: "B1 Preliminary", B2: "B2 First", C1: "C1 Advanced" };
const EXAM_TEEN: Record<string, string> = { A1: "A1 Movers", A2: "A2 Key for Schools", B1: "B1 Preliminary for Schools", B2: "B2 First for Schools", C1: "C1 Advanced" };

export function PlacementReview(p: ReviewProps) {
  const { t } = useT();
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
  const [lesson, setLesson] = useState<{ level: string; marks: Marks } | null>(p.review.lesson ? { level: p.review.lesson.level, marks: nums(p.review.lesson.marks) } : null);
  const [lessonMsg, setLessonMsg] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = setTimeout(() => { void saveReview(p.id, { writing: w, speaking: s, points: pts, comment, lesson }); }, 800);
    return () => clearTimeout(h);
  }, [w, s, pts, comment, lesson, p.id]);

  const wHint = p.d.writing ? scoreStep(p.rubrics.writing.map((c) => w[c.id]), p.d.writing.level as PLevel, w.task) : null;
  const sTask = p.d.speaking ? scoreStep(p.rubrics.speaking.map((c) => s[c.id]), p.d.speaking.level as PLevel) : null;
  // оценка говорения на уроке (вопросы уровнем выше/ниже) — самая свежая, поэтому идёт в итог, если заполнена полностью
  const sLesson = lesson ? scoreStep(p.rubrics.speaking.map((c) => lesson.marks[c.id]), lesson.level as PLevel) : null;
  const sHint = sLesson ?? sTask;
  const hint = finalHint([p.sm.coreStep, p.sm.vstep, p.sm.readStep, p.sm.listenStep, wHint, sHint]);
  const [lvl, setLvl] = useState(p.level ?? (hint !== null ? STEPS[hint] : ""));
  const L = ["A1", "A2", "B1", "B2", "C1"].filter((l) => p.sm.core[l] || p.sm.reading[l] || p.sm.listening[l]);
  const waiting = p.status === "new" || p.status === "active";

  // вывод системы обычными словами
  const pc = (r: [number, number]) => (r[1] ? Math.round((r[0] / r[1]) * 100) : 0);
  const sk = (r: Record<string, [number, number]>, s2: number | null, name: string) => {
    const lv = Object.keys(r).sort().reverse().find((l) => r[l][1]);
    return lv && s2 !== null ? t("pl.exSkill", { s: name, l: lv, p: pct(r[lv]) ?? 0, r: STEPS[s2] }) : null;
  };
  const sm = p.sm;
  const lines = [
    sm.diag ? t("pl.exDiag", { l: sm.diag, e: `${sm.easy[0]}/${sm.easy[1]}`, ep: pc(sm.easy), h: `${sm.hard[0]}/${sm.hard[1]}`, hp: pc(sm.hard), r: STEPS[sm.coreStep] }) : t("pl.exLow"),
    sm.fb && sm.diag ? t("pl.exFb", { l: PL_LEVELS[PL_LEVELS.indexOf(sm.diag) + 1] ?? "", d: sm.diag }) : null,
    sm.up && sm.diag ? t("pl.exUp", { l: prevLevel(sm.diag), d: sm.diag }) : null,
    !sm.up && sm.above[1] ? t("pl.exAbove", { l: PL_LEVELS[PL_LEVELS.indexOf(sm.diag ?? "A1") + 1] ?? "", c: sm.above[0], n: sm.above[1] }) : null,
    sm.forms.typed[1] && sm.forms.choice[1] ? t("pl.exForms", { a: `${sm.forms.choice[0]}/${sm.forms.choice[1]}`, b: `${sm.forms.typed[0]}/${sm.forms.typed[1]}` }) : null,
    sm.repeats.length ? t("pl.exRepeats", { n: sm.repeats.length, k: sm.repeats.filter((x) => !x.again).length, list: sm.repeats.map((x) => `${x.topic} ${x.again ? "✓" : "✗"}`).join("; ") }) : null,
    sm.vstep !== null ? t("pl.exVocab", { r: STEPS[sm.vstep], p: sm.vprobes.map((x) => `${x.level} ${x.c}/${x.n}`).join(" → ") }) : null,
    sk(sm.reading, sm.readStep, t("pl.part.reading")), sk(sm.listening, sm.listenStep, t("pl.part.listening")),
    hint !== null ? t(wHint === null || sHint === null ? "pl.exNeedWS" : "pl.exFinal", { h: STEPS[hint] }) : null,
  ].filter(Boolean) as string[];
  const famLv = PL_LEVELS.filter((l) => sm.families.some((f) => f.by?.[l]?.[1]));
  // лексика: где слабее всего — вид заданий с самой низкой долей верных (если заданий хотя бы 2)
  const vAll = (sm.vlevels ?? []).flatMap((x) => x.kinds.map((k) => ({ ...k, level: x.level })));
  const vWeak = vAll.filter((k) => k.n >= 2 && k.c / k.n < 0.6).sort((a, b) => a.c / a.n - b.c / b.n).slice(0, 3);
  const diagGroups = sm.groups.filter((g) => g.level === sm.diag);
  const otherGroups = sm.groups.filter((g) => g.level !== sm.diag);
  const growth = diagGroups.filter((g) => g.n >= 3 && g.c <= 1);
  const gState = (g: Summary["groups"][number]) => (g.n < 3 ? "few" : g.c === g.n ? "ok" : g.c >= g.n - 1 ? "mid" : "bad");
  const gRow = (g: Summary["groups"][number]) => {
    const k = gState(g);
    return (
      <div key={g.id} className={`plgrow ${k}`}>
        <span className="plgico">{k === "ok" ? "✓" : k === "mid" ? "≈" : k === "bad" ? "✗" : "·"}</span>
        <div className="grow min-w-0"><b>{g.name}</b>{g.what && <div className="small muted">{g.what}</div>}</div>
        <span className="plgres">{g.c}/{g.n}{g.dk > 0 && <small className="muted"> · {t("pl.dkShort", { n: g.dk })}</small>}</span>
        <span className="small plglab">{t(`pl.g.${k}` as DictKey)}</span>
      </div>
    );
  };
  // активное время = всё время в разделе минус перерывы; перерывы показываем отдельно
  const idle: Record<string, number> = { ...(p.d.idle ?? {}) }, pauses: Record<string, number> = { ...(p.d.pauses ?? {}) };
  // старые прохождения без отметок активности: в грамматике и лексике время каждого ответа известно — по нему и считаем
  for (const [k, vocab] of [["core", false], ["vocab", true]] as const) {
    if (idle[k] || !p.d.times[k]) continue;
    const work = p.d.core.filter((x) => !!x.vocab === vocab && x.ms !== null).reduce((a, x) => a + Math.min(x.ms!, 8 * 60e3), 0);
    if (work && p.d.times[k] - work > 8 * 60e3) { idle[k] = p.d.times[k] - work; pauses[k] = 1; }
  }
  const tm = Object.fromEntries(Object.entries(p.d.times).map(([k, v]) => [k, Math.max(0, v - (idle[k] ?? 0))]));
  const total = Object.values(tm).reduce((a, b) => a + b, 0);
  const idleAll = Object.values(idle).reduce((a, b) => a + b, 0);
  const coreMs = p.d.core.map((x) => x.ms).filter((x): x is number => x !== null);
  const fast = coreMs.filter((x) => x < 3000).length;
  const slow = [...p.d.core].filter((x) => x.ms !== null).sort((a, b) => b.ms! - a.ms!).slice(0, 3).filter((x) => x.ms! > 20000);
  const dks = p.d.core.filter((x) => x.dk).length + [...p.d.reading, ...p.d.listening].reduce((a, x) => a + x.questions.filter((q) => q.dk).length, 0);

  const descr = (c: Rubric, level: string, v: number) =>
    v === 3 ? `${t("pl.sc3")}: ${c.levels[level] ?? ""}` : v === 2 ? t("pl.sc2") : v === 1 ? (level === "A1" ? t("pl.sc1A1") : `${t("pl.sc1", { l: prevLevel(level) })}: ${c.levels[prevLevel(level)] ?? ""}`) : t("pl.sc0");
  const rubric = (title: string, list: Rubric[], m: Marks, set: (x: Marks) => void, h: number | null, level: string, aiKind?: "writing" | "speaking") => {
    const A = aiKind ? ai[aiKind] : undefined;
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
                {[0, 1, 2, 3].map((v) => <button key={v} type="button" role="radio" aria-checked={m[c.id] === v} className={m[c.id] === v ? "on" : ""} title={descr(c, level, v)} onClick={() => set({ ...m, [c.id]: v })}>{v}</button>)}
              </div>
            </div>
            {A?.why?.[c.id] && <div className="small plai-why"><Icon name="spark" size="sm" /> {A.why[c.id]}</div>}
            {/* шкала видна сразу: что значит каждый балл для этого уровня; строку можно нажать вместо кнопки */}
            <div className="plscale">
              {[3, 2, 1, 0].map((v) => (
                <button key={v} type="button" className={`plscrow ${m[c.id] === v ? "on" : ""}`} onClick={() => set({ ...m, [c.id]: v })}>
                  <b>{v}</b><span>{descr(c, level, v)}</span>
                </button>
              ))}
            </div>
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
            {down && <button type="button" className={`btn sm ${sug === "down" ? "primary" : "secondary"}`} disabled={pending} onClick={() => give(-1, down)}><Icon name="left" size="sm" />{t("pl.extraGive", { l: down })}</button>}
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

      <section className="card flex flex-col gap-3">
        <h3 className="m-0">{t("pl.table")}</h3>
        <div className="tblwrap">
          <table className="pltable">
            <thead><tr><th />{L.map((l) => <th key={l}>{l}</th>)}</tr></thead>
            <tbody>
              <tr><th>{t("pl.grammar")}</th>{L.map((l) => <td key={l}>{cell(p.sm.core[l]?.grammar)}</td>)}</tr>
              <tr><th>{t("pl.vocab")}</th>{L.map((l) => <td key={l}>{cell(p.sm.core[l]?.vocabulary)}</td>)}</tr>
              <tr><th>{t("pl.part.reading")}</th>{L.map((l) => <td key={l}>{cell(p.sm.reading[l])}</td>)}</tr>
              <tr><th>{t("pl.part.listening")}</th>{L.map((l) => <td key={l}>{cell(p.sm.listening[l])}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="plpath">
          <span className="small muted">{t("pl.anchors")}:</span>
          {sm.anchors.map((x) => <span key={x.level} className={`pill ${x.pass ? "green" : x.pass === false ? "orange" : "grey"}`}>{x.level} {x.pass ? "✓" : x.pass === false ? "✗" : ""} {x.c}/{x.n}</span>)}
          {sm.diag && <><Icon name="right" size="sm" /><span className="small muted">{t("pl.diagAt")}</span><span className="pill">{sm.diag}</span></>}
        </div>
        <div className="plsteps">
          <div><span>{t("pl.part.core")}</span><b>{STEPS[p.sm.coreStep]}</b></div>
          <div><span>{t("pl.part.vocab")}</span><b>{p.sm.vstep !== null ? STEPS[p.sm.vstep] : "—"}</b></div>
          <div><span>{t("pl.part.reading")}</span><b>{p.sm.readStep !== null ? STEPS[p.sm.readStep] : "—"}</b></div>
          <div><span>{t("pl.part.listening")}</span><b>{p.sm.listenStep !== null ? STEPS[p.sm.listenStep] : "—"}</b></div>
          <div><span>{t("pl.part.writing")}</span><b>{wHint !== null ? STEPS[wHint] : "—"}</b></div>
          <div><span>{t("pl.part.speaking")}</span><b>{sHint !== null ? STEPS[sHint] : "—"}</b></div>
        </div>
        <div className="plexplain">
          <div className="flex items-center gap-2"><Icon name="spark" size="sm" /><b>{t("pl.exTitle")}</b></div>
          {lines.map((x) => <p key={x} className="m-0">{x}</p>)}
          <details><summary className="small">{t("pl.howRead")}</summary><p className="small mt-2 mb-0">{t("pl.howReadText")}</p></details>
        </div>
      </section>

      {sm.families.length > 0 && (
        <section className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 grow">{t("pl.famTitle")}</h3><span className="small muted">{t("pl.famLegend")}</span></div>
          <div className="tblwrap">
            <table className="pltable plfam">
              <thead><tr><th>{t("pl.famCol")}</th>{famLv.map((l) => <th key={l} className={l === sm.diag ? "plfam-diag" : undefined}>{l}{l === sm.diag && <div className="small muted">{t("pl.famDiag")}</div>}</th>)}<th>{t("pl.famAll")}</th><th /></tr></thead>
              <tbody>
                {sm.families.map((f) => {
                  // как в доборе: если у раздела есть темы на уровне проверки — оцениваем по ним, иначе по всем ответам
                  const r = sm.diag && (f.has ? f.has.includes(sm.diag) : (f.lvl[1] ?? 0) >= 2) ? f.lvl : f.all, q = r[1] ? r[0] / r[1] : 0;
                  const k = r[1] < 3 ? "few" : q >= 0.85 ? "ok" : q >= 0.5 ? "mid" : "bad";
                  return (
                    <tr key={f.id} className={`plfam-${k}`}>
                      <th><b>{f.name}</b><div className="small muted">{f.what}</div></th>
                      {famLv.map((l) => <td key={l} className={l === sm.diag ? "plfam-diag" : undefined}>{f.by?.[l]?.[1] ? <b>{f.by[l][0]}/{f.by[l][1]}</b> : f.has && !f.has.includes(l) ? <span className="small muted">{t("pl.famNotIn")}</span> : <span className="muted">—</span>}</td>)}
                      <td><b>{f.all[0]}/{f.all[1]}</b> <span className="muted">{pct(f.all)}%</span></td>
                      <td className="plfam-st">{t(`pl.g.${k}` as DictKey)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sm.groups.length > 0 && (
        <section className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 grow">{t("pl.mapTitle", { l: sm.diag ?? "" })}</h3><span className="small muted">{t("pl.mapLegend")}</span></div>
          {growth.length > 0 ? <div className="plgrowth"><b>{t("pl.growth")}:</b> {growth.map((g) => g.name).join(", ")}</div> : diagGroups.length > 0 && <div className="plgrowth ok">{t("pl.noGrowth")}</div>}
          <div className="plgroups">{diagGroups.map(gRow)}</div>
          {otherGroups.length > 0 && <details><summary className="small">{t("pl.mapOther")}</summary><div className="plgroups mt-2">{otherGroups.map(gRow)}</div></details>}
          {(sm.vlevels ?? []).length > 0 && (
            <>
              <h3 className="mb-0 mt-2">{t("pl.vTitle")}</h3>
              <div className="tblwrap">
                <table className="pltable plfam">
                  <thead><tr><th>{t("pl.vKind")}</th>{sm.vlevels.map((x) => <th key={x.level} className={x.level === sm.vlevel ? "plfam-diag" : undefined}>{x.level}<div className="small muted">{x.warm ? t("pl.vWarm") : x.level === sm.vlevel ? t("pl.vMain") : t("pl.vUp")}</div></th>)}</tr></thead>
                  <tbody>
                    {[...new Set(sm.vlevels.flatMap((x) => x.kinds.map((k) => k.name)))].map((name) => (
                      <tr key={name}><th><b>{name}</b></th>{sm.vlevels.map((x) => { const k = x.kinds.find((y) => y.name === name); return <td key={x.level} className={x.level === sm.vlevel ? "plfam-diag" : undefined}>{k ? <b className={k.c === k.n ? "plc-ok" : k.c === 0 ? "plc-bad" : undefined}>{k.c}/{k.n}</b> : <span className="muted">—</span>}</td>; })}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={`plgrowth ${vWeak.length ? "" : "ok"}`}>
                {vWeak.length ? <><b>{t("pl.vWeak")}:</b> {vWeak.map((k) => `${k.name} (${k.level}, ${k.c}/${k.n})`).join("; ")}</> : t("pl.vNoWeak")}
                {sm.vweak?.length > 0 && <div className="small mt-1">{t("pl.vTopics")}: {sm.vweak.slice(0, 8).join(", ")}</div>}
              </div>
            </>
          )}
        </section>
      )}

      {total > 0 && (
        <section className="card flex flex-col gap-3">
          <div className="flex items-center gap-2"><h3 className="m-0 grow">{t("pl.timeTitle")}</h3><b>{fmtSec(total)}</b></div>
          {idleAll > 0 && <p className="small muted m-0">{t("pl.timeIdleNote", { s: fmtSec(idleAll) })}</p>}
          <div className="plsteps">
            {["core", "vocab", "reading", "listening", "writing", "speaking"].map((k) => <div key={k}><span>{t(`pl.part.${k}` as DictKey)}</span><b className="text-[16px]">{tm[k] ? fmtSec(tm[k]) : "—"}</b>{idle[k] ? <span className="small muted">{t("pl.timeIdle", { s: fmtSec(idle[k]), n: pauses[k] ?? 1 })}</span> : null}</div>)}
          </div>
          <div className="small flex flex-col gap-1">
            {coreMs.length > 0 && <span>{t("pl.timeAvg", { s: fmtSec(coreMs.reduce((a, b) => a + b, 0) / coreMs.length) })}</span>}
            {fast > 0 && <span className="text-bad">{t("pl.timeFast", { n: fast })}</span>}
            {dks > 0 && <span>{t("pl.dkCount", { n: dks })}</span>}
            {slow.length > 0 && <span className="muted">{t("pl.timeSlow")}: {slow.map((x) => `«${x.q.slice(0, 40)}…» — ${fmtSec(x.ms!)}`).join("; ")}</span>}
            {[...p.d.listening].map((x) => <span key={x.id} className="muted">{t("pl.playsOf", { title: x.title, n: x.plays ?? 0 })}</span>)}
          </div>
          <p className="hint m-0">{t("pl.timeNote")}</p>
        </section>
      )}

      {p.d.writing && (
        <section className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 grow">{t("pl.part.writing")}</h3><span className="pill grey">{p.d.writing.level}</span></div>
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
          {extraBox("writing", p.d.writing.level, w, p.rubrics.writing)}
          {prevBlock("writing")}
        </section>
      )}

      {p.d.speaking && (
        <section className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 grow">{t("pl.part.speaking")}</h3><span className="pill grey">{p.d.speaking.level}</span></div>
          {p.d.speaking.noMic && <div className="alert">{t("pl.noMicNote")}</div>}
          {p.d.speaking.questions.map((q, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span className="small"><b>{i + 1}.</b> {q.q}{q.rerec > 0 && <span className="muted"> · {t("pl.rerecN", { n: q.rerec })}</span>}{q.peek && <span className="pill orange ml-1">{t("pl.peeked")}</span>}</span>
              {q.url ? <audio controls preload="none" src={q.url} className="w-full" /> : <span className="small muted">{t("pl.noRec")}</span>}
            </div>
          ))}
          <details><summary className="small">{t("pl.expects")}</summary><ul className="small mt-2">{p.d.speaking.expects.map((e) => <li key={e}>{e}</li>)}</ul></details>
          {rubric(t("pl.part.speaking"), p.rubrics.speaking, s, setS, sTask, p.d.speaking.level, p.d.speaking.questions.some((q) => q.url) ? "speaking" : undefined)}
          {extraBox("speaking", p.d.speaking.level, s, p.rubrics.speaking)}
          {prevBlock("speaking")}
          {lessonBox()}
        </section>
      )}

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
          <div className="field"><label htmlFor="pl-c">{t("pl.comment")}</label><textarea id="pl-c" className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("pl.commentPh")} /></div>
          {p.mode === "student" && (
            <label className="setting"><span>{t("pl.showToStudent")}<span className="small muted block">{p.level ? t("pl.showHint") : t("pl.showNeedLevel")}</span></span>
              <span className="switch"><input type="checkbox" checked={p.showResult} disabled={pending || !p.level} onChange={(e) => run(() => setShowResult(p.id, e.target.checked))} /><span /></span></label>
          )}
          {error && <div className="alert">{error}</div>}
        </section>
      )}
      {/* удаление — для пробных и случайных прохождений (например, ссылку открыл не тот человек); у ученика пропадёт и результат в кабинете */}
      <div className="flex flex-wrap items-center justify-end gap-2"><span className="small muted">{t("pl.deleteHint")}</span><button className="btn plain sm" onClick={() => { if (confirm(t("pl.delConfirm"))) run(() => deletePlacement(p.id), () => location.assign("/teacher/courses?tab=tests"), true); }}><Icon name="close" size="sm" />{t("pl.delete")}</button></div>
    </div>
  );
}
