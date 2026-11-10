"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { deletePlacement, finalizePlacement, saveReview, setShowResult } from "@/lib/placement/actions";
import { finalHint, PL_LEVELS, scoreStep, STEPS, type PLevel, type Summary } from "@/lib/placement/engine";
import type { ReviewData } from "@/lib/placement/review";
import type { Rubric } from "@/lib/placement/bank";
import { useRun } from "../courses/useRun";
import { Icon } from "../Icon";
import { fmtSec } from "./PlacementAnswers";
import type { DictKey } from "@/lib/i18n/dict";

type Marks = Record<string, number>;
export type ReviewProps = {
  id: string; mode: string; status: string; level: string | null; showResult: boolean;
  sm: Summary; d: ReviewData; review: { writing?: Record<string, unknown>; speaking?: Record<string, unknown>; points?: boolean[]; comment?: string };
  rubrics: { writing: Rubric[]; speaking: Rubric[] }; howTo: string; sublevels: string; total: string;
};
const nums = (m?: Record<string, unknown>): Marks => Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => typeof v === "number")) as Marks;
const prevLevel = (l: string) => PL_LEVELS[Math.max(0, PL_LEVELS.indexOf(l as PLevel) - 1)];

const pct = (r?: [number, number]) => (r && r[1] ? Math.round((r[0] / r[1]) * 100) : null);
const cell = (r?: [number, number]) => (r && r[1] ? <><b>{pct(r)}%</b> <span className="muted">{r[0]}/{r[1]}</span></> : <span className="muted">—</span>);

/** Проверка вводного теста учителем: таблица по навыкам, оценки письма и говорения по критериям, итог. */
export function PlacementReview(p: ReviewProps) {
  const { t } = useT();
  const { run, pending, error } = useRun();
  const [w, setW] = useState<Marks>(nums(p.review.writing));
  const [s, setS] = useState<Marks>(nums(p.review.speaking));
  const [pts, setPts] = useState<boolean[]>(p.review.points ?? []);
  const [comment, setComment] = useState(p.review.comment ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = setTimeout(() => { void saveReview(p.id, { writing: w, speaking: s, points: pts, comment }); }, 800);
    return () => clearTimeout(h);
  }, [w, s, pts, comment, p.id]);

  const wHint = p.d.writing ? scoreStep(p.rubrics.writing.map((c) => w[c.id]), p.d.writing.level as PLevel, w.task) : null;
  const sHint = p.d.speaking ? scoreStep(p.rubrics.speaking.map((c) => s[c.id]), p.d.speaking.level as PLevel) : null;
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
    sm.vstep !== null ? t("pl.exVocab", { r: STEPS[sm.vstep], p: sm.vprobes.map((x) => `${x.level} ${x.c}/${x.n}`).join(" → ") }) : null,
    sk(sm.reading, sm.readStep, t("pl.part.reading")), sk(sm.listening, sm.listenStep, t("pl.part.listening")),
    hint !== null ? t(wHint === null || sHint === null ? "pl.exNeedWS" : "pl.exFinal", { h: STEPS[hint] }) : null,
  ].filter(Boolean) as string[];
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
  const tm = p.d.times;
  const total = Object.values(tm).reduce((a, b) => a + b, 0);
  const coreMs = p.d.core.map((x) => x.ms).filter((x): x is number => x !== null);
  const fast = coreMs.filter((x) => x < 3000).length;
  const slow = [...p.d.core].filter((x) => x.ms !== null).sort((a, b) => b.ms! - a.ms!).slice(0, 3).filter((x) => x.ms! > 20000);
  const dks = p.d.core.filter((x) => x.dk).length + [...p.d.reading, ...p.d.listening].reduce((a, x) => a + x.questions.filter((q) => q.dk).length, 0);

  const descr = (c: Rubric, level: string, v: number) =>
    v === 3 ? `${t("pl.sc3")}: ${c.levels[level] ?? ""}` : v === 2 ? `${t("pl.sc2")}: ${c.levels[level] ?? ""}` : v === 1 ? (level === "A1" ? t("pl.sc1A1") : `${t("pl.sc1", { l: prevLevel(level) })}: ${c.levels[prevLevel(level)] ?? ""}`) : t("pl.sc0");
  const rubric = (title: string, list: Rubric[], m: Marks, set: (x: Marks) => void, h: number | null, level: string) => {
    const done = list.filter((c) => typeof m[c.id] === "number");
    const sum = done.reduce((a, c) => a + m[c.id], 0);
    return (
      <div className="plrub">
        <div className="flex flex-wrap items-center gap-2"><b className="grow">{t("pl.scTitle", { l: level })}</b>
          {done.length === list.length ? <span className="pill">{t("pl.scSum", { s: sum, m: list.length * 3 })} → {h !== null ? STEPS[h] : "—"}</span> : <span className="small muted">{t("pl.scLeft", { n: list.length - done.length })}</span>}
        </div>
        {list.map((c) => (
          <div key={c.id} className="plcrit2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="small font-semibold grow">{c.name_ru}</span>
              <div className="plscore" role="radiogroup" aria-label={`${title}: ${c.name_ru}`}>
                {[0, 1, 2, 3].map((v) => <button key={v} type="button" role="radio" aria-checked={m[c.id] === v} className={m[c.id] === v ? "on" : ""} title={descr(c, level, v)} onClick={() => set({ ...m, [c.id]: v })}>{v}</button>)}
              </div>
            </div>
            <div className="small muted">{typeof m[c.id] === "number" ? descr(c, level, m[c.id]) : `${t("pl.sc3")}: ${c.levels[level] ?? ""}`}</div>
          </div>
        ))}
        <details><summary className="small">{t("pl.scHow")}</summary><p className="small mt-2 mb-0">{p.total}</p></details>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {waiting && <div className="alert"><Icon name="hourglass" size="sm" /> {t("pl.inProgress")}</div>}

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

      {sm.groups.length > 0 && (
        <section className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 grow">{t("pl.mapTitle", { l: sm.diag ?? "" })}</h3><span className="small muted">{t("pl.mapLegend")}</span></div>
          {growth.length > 0 ? <div className="plgrowth"><b>{t("pl.growth")}:</b> {growth.map((g) => g.name).join(", ")}</div> : diagGroups.length > 0 && <div className="plgrowth ok">{t("pl.noGrowth")}</div>}
          <div className="plgroups">{diagGroups.map(gRow)}</div>
          {otherGroups.length > 0 && <details><summary className="small">{t("pl.mapOther")}</summary><div className="plgroups mt-2">{otherGroups.map(gRow)}</div></details>}
          {sm.vgroups.length > 0 && <><h3 className="mb-0 mt-2">{t("pl.vmapTitle", { l: sm.vlevel ?? "" })}</h3><div className="plgroups">{sm.vgroups.map(gRow)}</div></>}
        </section>
      )}

      {total > 0 && (
        <section className="card flex flex-col gap-3">
          <div className="flex items-center gap-2"><h3 className="m-0 grow">{t("pl.timeTitle")}</h3><b>{fmtSec(total)}</b></div>
          <div className="plsteps">
            {["core", "vocab", "reading", "listening", "writing", "speaking"].map((k) => <div key={k}><span>{t(`pl.part.${k}` as DictKey)}</span><b className="text-[16px]">{tm[k] ? fmtSec(tm[k]) : "—"}</b></div>)}
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
          {rubric(t("pl.part.writing"), p.rubrics.writing, w, setW, wHint, p.d.writing.level)}
        </section>
      )}

      {p.d.speaking && (
        <section className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 grow">{t("pl.part.speaking")}</h3><span className="pill grey">{p.d.speaking.level}</span></div>
          {p.d.speaking.noMic && <div className="alert">{t("pl.noMicNote")}</div>}
          {p.d.speaking.questions.map((q, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span className="small"><b>{i + 1}.</b> {q.q}{q.rerec > 0 && <span className="muted"> · {t("pl.rerecN", { n: q.rerec })}</span>}</span>
              {q.url ? <audio controls preload="none" src={q.url} className="w-full" /> : <span className="small muted">{t("pl.noRec")}</span>}
            </div>
          ))}
          <details><summary className="small">{t("pl.expects")}</summary><ul className="small mt-2">{p.d.speaking.expects.map((e) => <li key={e}>{e}</li>)}</ul></details>
          {rubric(t("pl.part.speaking"), p.rubrics.speaking, s, setS, sHint, p.d.speaking.level)}
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
      <div className="flex justify-end"><button className="btn plain sm" onClick={() => { if (confirm(t("pl.delConfirm"))) run(() => deletePlacement(p.id), () => location.assign("/teacher/courses?tab=tests"), true); }}>{t("pl.delete")}</button></div>
    </div>
  );
}
