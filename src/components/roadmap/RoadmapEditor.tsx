"use client";
import { useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { assignPlacement } from "@/lib/placement/actions";
import { ExpectField, TrackField, trackForAge, type PlTrack } from "../placement/PlacementPanel";
import { approveRoadmap, assignTest, buildRoadmap, deleteCheckpoint, editStage, manualResults, type RoadmapForm } from "@/lib/roadmap/actions";
import { LEVELS, ROUTE_TYPES, SKILL_COLOR, SKILL_NAME, SKILLS, txt, type Skill } from "@/lib/roadmap/cefr";
import { etaRange, fmtHM, PACES, paceKey, paceLabel, parsePace } from "@/lib/roadmap/math";
import { useRun } from "../courses/useRun";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { makeRecorder, transcribe } from "../ai/audio";
import { Mountain } from "./Mountain";

export type CP = { id: string; kind: string; status: string; source: string; level: string | null; skills: Partial<Record<Skill, number>>; weak: [string, string][]; takenAt: string | null; assignedAt: string; stage: number | null; placement?: string | null; pstatus?: string | null };
export type EditorData = {
  studentId: string; first: string; ini: string; level: string | null; age?: number | null; teenAvail?: boolean;
  courses: { id: string; title: string; units: number }[];
  checkpoints: CP[];
  roadmap: null | {
    id: string; type: string; goal: string; fromLevel: string | null; deadline: string | null; showDate: boolean; pace: string; mood: string; note: string;
    courseIds: string[]; leadCourseId: string | null; approved: boolean; built: boolean; summary: string | null;
    stages: { lvl: string; title: string; hours: number; grammar: string[]; vocabulary: string[]; skills: string[]; passed: boolean }[];
    criteria: string[]; units: string[]; done: number; ci: number; left: number; lessonMin: number; lateWeeks: number;
  };
};

export function SkillBars({ skills, prev }: { skills: Partial<Record<Skill, number>>; prev?: Partial<Record<Skill, number>> }) {
  const { lang } = useT();
  return (
    <div className="flex flex-col gap-2">
      {SKILLS.filter((k) => skills[k] !== undefined).map((k) => {
        const v = skills[k]!, p = prev?.[k];
        return (
          <div key={k} className="skillrow">
            <span>{txt(SKILL_NAME[k], lang)}</span>
            <span className="skilltrack"><span style={{ width: `${v}%`, background: v < 60 ? "var(--warn)" : SKILL_COLOR[k] }} /></span>
            <b>{v}%{p !== undefined && v !== p && <small className={v > p ? "text-ok" : "text-bad"}> {v > p ? "▲" : "▼"}{Math.abs(v - p)}</small>}</b>
          </div>
        );
      })}
    </div>
  );
}

function Checkpoints({ d }: { d: EditorData }) {
  const { t, lang } = useT();
  const { run, pending } = useRun();
  const doneList = d.checkpoints.filter((c) => c.status === "done");
  const [i, setI] = useState(doneList.length - 1);
  const [manual, setManual] = useState(false);
  const [asg, setAsg] = useState(false);
  const [exp, setExp] = useState("");
  const [track, setTrack] = useState<PlTrack>(d.teenAvail ? trackForAge(d.age) : "adult");
  const [m, setM] = useState<{ level: string; skills: Record<string, string> }>({ level: d.level ?? "B1", skills: {} });
  const open = d.checkpoints.find((c) => c.status === "assigned" || c.status === "review");
  const c = doneList[Math.max(0, Math.min(i, doneList.length - 1))];
  const prev = doneList[doneList.indexOf(c) - 1];
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <section className="card">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="m-0 grow">{c ? (c.kind === "entry" ? t("rm.entry") : t("rm.slice")) : t("rm.entry")}</h3>
        {doneList.length > 1 && <>
          <button className="iconbtn" disabled={doneList.indexOf(c) === 0} onClick={() => setI(doneList.indexOf(c) - 1)} aria-label={t("rm.prevTest")}><Icon name="chevl" size="sm" /></button>
          <span className="small muted">{doneList.indexOf(c) + 1} / {doneList.length}</span>
          <button className="iconbtn" disabled={doneList.indexOf(c) === doneList.length - 1} onClick={() => setI(doneList.indexOf(c) + 1)} aria-label={t("rm.nextTest")}><Icon name="right" size="sm" /></button>
        </>}
      </div>
      {c ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2"><span className="lvlbig">{c.level}</span><span className="small muted">{c.takenAt ? new Date(c.takenAt).toLocaleDateString(loc, { day: "numeric", month: "long" }) : ""} · {c.source === "manual" ? t("rm.manual") : t("rm.byTest")}</span></div>
          <SkillBars skills={c.skills} prev={prev?.skills} />
          {c.weak.length > 0 && <div className="mt-3 small"><b>{t("rm.weak")}:</b> {c.weak.map((w) => txt(w, lang)).join(", ")}</div>}
        </>
      ) : <p className="hint mt-0">{t("rm.noTest")}</p>}
      {open && (
        <div className="alert mt-3 flex flex-wrap items-center gap-2"><Icon name="hourglass" size="sm" />
          <span className="grow">{open.status === "review" ? t("pl.toReview") : open.pstatus === "active" ? t("pl.studentTaking") : open.kind === "entry" ? t("rm.entryAssigned") : t("rm.sliceAssigned")}</span>
          {open.placement && open.status === "review" && <a className="btn primary sm" href={`/teacher/placement/${open.placement}`}>{t("pl.review")}</a>}
        </div>
      )}
      {c?.placement && <a className="small alink mt-2 inline-block" href={`/teacher/placement/${c.placement}`}>{t("pl.openResult")}</a>}
      <div className="mt-4 flex flex-wrap gap-2">
        {!doneList.length ? <button className="btn primary sm" disabled={pending} onClick={() => setAsg(true)}>{t("rm.assignEntry")}</button>
          : <button className="btn secondary sm" disabled={pending} onClick={() => run(() => assignTest(d.studentId, "slice", d.roadmap?.ci ?? 0))}>{t("rm.assignSlice")}</button>}
        <button className="btn plain sm" onClick={() => setManual(true)}>{t("rm.enterManual")}</button>
        {c && <button className="btn plain sm" onClick={() => { if (confirm(t("rm.delTest"))) run(() => deleteCheckpoint(c.id)); }}>{t("common.delete")}</button>}
      </div>
      <p className="hint mb-0 mt-3">{t("rm.testHint")}</p>
      <Dialog open={asg} onClose={() => setAsg(false)} title={t("rm.assignEntry")}>
        {d.teenAvail && <TrackField value={track} onChange={setTrack} age={d.age} />}
        <ExpectField value={exp} onChange={setExp} teen={track === "teen"} />
        <p className="small muted">{t("pl.assignHint")}</p>
        <div className="actions"><button className="btn secondary" onClick={() => setAsg(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending} onClick={() => run(() => assignPlacement(d.studentId, exp || null, track), () => setAsg(false))}>{t("pl.assignDo")}</button></div>
      </Dialog>
      <Dialog open={manual} onClose={() => setManual(false)} title={t("rm.enterManual")}>
        <div className="field"><label htmlFor="mr-l">{t("prof.level")}</label><select id="mr-l" className="select" value={m.level} onChange={(e) => setM({ ...m, level: e.target.value })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {SKILLS.map((k) => <div key={k} className="field"><label htmlFor={`mr-${k}`}>{txt(SKILL_NAME[k], lang)}, %</label><input id={`mr-${k}`} className="input" inputMode="numeric" value={m.skills[k] ?? ""} onChange={(e) => setM({ ...m, skills: { ...m.skills, [k]: e.target.value.replace(/\D/g, "").slice(0, 3) } })} /></div>)}
        </div>
        <div className="actions"><button className="btn secondary" onClick={() => setManual(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending} onClick={() => run(() => manualResults(d.studentId, doneList.length ? "slice" : "entry", m.level, Object.fromEntries(Object.entries(m.skills).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]))), () => setManual(false))}>{t("common.save")}</button></div>
      </Dialog>
    </section>
  );
}

export function RoadmapEditor({ d }: { d: EditorData }) {
  const { t, lang } = useT();
  const { run, pending, error } = useRun();
  const r = d.roadmap;
  const lastTest = [...d.checkpoints].reverse().find((c) => c.status === "done");
  const [f, setF] = useState<RoadmapForm>({
    type: r?.type ?? "ge", goal: r?.goal ?? "", fromLevel: r?.fromLevel ?? lastTest?.level ?? d.level?.match(/[ABC][12]\+?/)?.[0] ?? "",
    courseIds: r?.courseIds ?? [], leadCourseId: r?.leadCourseId ?? null, deadline: r?.deadline ?? null, showDate: r?.showDate ?? false,
    pace: r?.pace ?? "2:20", mood: r?.mood ?? "plan", note: r?.note ?? "",
  });
  const goals = ROUTE_TYPES[f.type]?.goals ?? [];
  const goal = goals.includes(f.goal) ? f.goal : goals[Math.min(goals.length - 1, f.type === "ge" ? 5 : 0)];
  const [rec, setRec] = useState<"idle" | "rec" | "busy">("idle");
  const recorder = useRef<ReturnType<typeof makeRecorder> | null>(null);
  const [sel, setSel] = useState<number | undefined>(undefined);
  const dictate = async () => {
    if (rec === "rec") {
      setRec("busy");
      try { const text = await transcribe(await recorder.current!.stop(), "ru-RU"); setF((x) => ({ ...x, note: `${x.note ? `${x.note} ` : ""}${text}`.trim() })); } catch { /* микрофон недоступен */ }
      setRec("idle"); return;
    }
    try { recorder.current = makeRecorder(); await recorder.current.start(); setRec("rec"); } catch { setRec("idle"); }
  };
  const blk = (title: string, children: React.ReactNode) => <div className="dblk"><div className="small mb-2 font-bold text-text2">{title}</div>{children}</div>;

  return (
    <div className="rmgrid">
      <div className="flex flex-col gap-4">
        <Checkpoints d={d} />
        <section className="card flex flex-col gap-4">
          <div className="flex items-center gap-2"><span className="tk-aiico"><Icon name="spark" size="sm" /></span><h3 className="m-0">{t("rm.data")}</h3></div>
          {blk(t("rm.type"), <div className="flex flex-wrap gap-1.5">{Object.entries(ROUTE_TYPES).map(([k, v]) => <button key={k} type="button" className={`pchip ${f.type === k ? "on" : ""}`} aria-pressed={f.type === k} onClick={() => setF({ ...f, type: k, goal: "" })}>{txt(v.name, lang)}</button>)}</div>)}
          <div className="grid grid-cols-2 gap-3">
            <div className="field"><label htmlFor="rm-from">{t("rm.from")}</label><select id="rm-from" className="select" value={f.fromLevel} onChange={(e) => setF({ ...f, fromLevel: e.target.value })}><option value="">{t("rm.fromTest")}</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></div>
            <div className="field"><label htmlFor="rm-goal">{t("rm.goal")}</label><select id="rm-goal" className="select" value={goal} onChange={(e) => setF({ ...f, goal: e.target.value })}>{goals.map((g) => <option key={g}>{g}</option>)}</select></div>
          </div>
          {blk(t("rm.courses"), d.courses.length ? (
            <div className="flex flex-col gap-1">
              {d.courses.map((c) => {
                const on = f.courseIds.includes(c.id);
                return (
                  <div key={c.id} className="flex items-center gap-2">
                    <label className="flex grow items-center gap-2"><input type="checkbox" checked={on} onChange={(e) => setF({ ...f, courseIds: e.target.checked ? [...f.courseIds, c.id] : f.courseIds.filter((x) => x !== c.id), leadCourseId: !e.target.checked && f.leadCourseId === c.id ? null : f.leadCourseId })} />{c.title} <span className="small muted">· {t("rm.nUnits", { n: c.units })}</span></label>
                    {on && <label className="small flex items-center gap-1"><input type="radio" name="lead" checked={f.leadCourseId === c.id} onChange={() => setF({ ...f, leadCourseId: c.id })} />{t("rm.lead")}</label>}
                  </div>
                );
              })}
              <span className="hint">{f.leadCourseId ? t("rm.leadOn", { n: d.courses.find((c) => c.id === f.leadCourseId)?.units ?? 0 }) : t("rm.leadOff")}</span>
            </div>
          ) : <span className="hint">{t("rm.noCourses")}</span>)}
          {blk(t("rm.deadline"), (
            <div className="flex flex-col gap-2">
              <label className="setting"><span>{t("rm.useDate")}</span><span className="switch"><input type="checkbox" checked={!!f.deadline} onChange={(e) => { const d2 = new Date(); d2.setMonth(d2.getMonth() + 6); setF({ ...f, deadline: e.target.checked ? d2.toISOString().slice(0, 7) : null }); }} /><span /></span></label>
              {f.deadline && <>
                <input type="month" className="input" value={f.deadline} aria-label={t("rm.deadline")} onChange={(e) => setF({ ...f, deadline: e.target.value || null })} />
                <label className="setting"><span>{t("rm.showDate")}</span><span className="switch"><input type="checkbox" checked={f.showDate} onChange={(e) => setF({ ...f, showDate: e.target.checked })} /><span /></span></label>
              </>}
              <span className="hint">{!f.deadline ? t("rm.noDateHint") : f.showDate ? t("rm.dateShown") : t("rm.dateMine")}</span>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-3">
            <div className="field"><label htmlFor="rm-pace">{t("rm.pace")}</label><select id="rm-pace" className="select" value={f.pace} onChange={(e) => setF({ ...f, pace: e.target.value })}>{PACES.map((p) => <option key={paceKey(p)} value={paceKey(p)}>{paceLabel(p, lang)}</option>)}</select></div>
            <div className="field"><span className="flabel">{t("rm.mood")}</span><div className="seg">{(["plan", "more", "slack"] as const).map((k) => <button key={k} type="button" aria-pressed={f.mood === k} onClick={() => setF({ ...f, mood: k })}>{t(`rm.mood.${k}`)}</button>)}</div></div>
          </div>
          <div className="field">
            <label htmlFor="rm-note">{t("rm.note")}</label>
            <textarea id="rm-note" className="textarea" value={f.note} placeholder={t("rm.notePh")} onChange={(e) => setF({ ...f, note: e.target.value })} />
            <button type="button" className={`btn ${rec === "rec" ? "danger" : "plain"} sm self-start`} disabled={rec === "busy"} onClick={dictate}><Icon name="mic" size="sm" />{rec === "rec" ? t("rm.stopDictate") : rec === "busy" ? t("ai.thinking") : t("rm.dictate")}</button>
          </div>
          {error && <div className="alert">{error}</div>}
          <button className="btn primary lg w-full" disabled={pending} onClick={() => run(() => buildRoadmap(d.studentId, { ...f, goal }))}><Icon name="spark" />{pending ? t("ai.thinking") : r?.built ? t("rm.rebuild") : t("rm.build")}</button>
        </section>
      </div>

      <div className="flex flex-col gap-4">
        {!r?.built ? (
          <section className="card rtempty"><Icon name="spark" /><div><b>{t("rm.emptyTitle")}</b><div className="small muted">{t("rm.emptySub")}</div></div></section>
        ) : (
          <>
            <section className="card">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="m-0 grow">{r.fromLevel} → {r.goal}</h3>
                {r.approved ? <span className="pill green"><Icon name="check" size="sm" />{t("rm.approved")}</span> : <span className="pill orange"><Icon name="spark" size="sm" />{t("rm.draft")}</span>}
                {r.approved && r.lateWeeks > 0 && <span className="pill red">{t("rm.late", { n: r.lateWeeks })}</span>}
              </div>
              <dl className="kv">
                <dt>{t("rm.pace")}</dt><dd>{paceLabel(parsePace(r.pace), lang)}</dd>
                <dt>{t("rm.eta")}</dt><dd><b>{r.deadline && r.showDate ? etaRange(r.left, parsePace(r.pace), lang, r.lessonMin) : t("rm.hoursLeft", { n: Math.round(r.left) })}</b>{r.deadline && !r.showDate && <> · {etaRange(r.left, parsePace(r.pace), lang, r.lessonMin)} <span className="pill grey">{t("rm.onlyYou")}</span></>}{!r.deadline && <span className="small muted"> · ≈ {etaRange(r.left, parsePace(r.pace), lang, r.lessonMin)}</span>}</dd>
                <dt>{t("rm.course")}</dt><dd>{r.leadCourseId ? `${d.courses.find((c) => c.id === r.leadCourseId)?.title ?? "—"}, ${t("rm.nUnits", { n: r.units.length })}` : <span className="muted">{t("rm.noLead")}</span>}</dd>
                <dt>{t("rm.done")}</dt><dd>{fmtHM(r.done, lang)}</dd>
              </dl>
              {r.summary && <div className="aianswer mt-3"><span className="tk-aiico"><Icon name="spark" size="sm" /></span><p className="m-0">{r.summary}</p></div>}
            </section>
            <div className="mtnwrap"><Mountain stages={r.stages} done={r.done} start={r.fromLevel ?? "A"} ini={d.ini} label={t("rm.isHere", { name: d.first })} units={r.units} ci={r.ci} sel={sel} onSelect={setSel} h={400} /></div>
            <section className="card">
              <h3 className="mt-0">{t("rm.stages")}</h3>
              <div className="flex flex-col gap-2">
                {r.stages.map((s, i) => (
                  <details key={i} className={`stagerow ${i === r.ci ? "cur" : ""}`} open={sel === i} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setSel(i)}>
                    <summary><span className="lvlbig sm">{s.lvl}</span><b className="grow">{s.title}</b>{s.passed && <span className="pill green">✓</span>}<span className="small muted">{s.hours} {t("rm.h")}</span></summary>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="field"><label className="small muted" htmlFor={`st-t-${i}`}>{t("crs.title")}</label><input id={`st-t-${i}`} className="input" defaultValue={s.title} onBlur={(e) => e.target.value !== s.title && run(() => editStage(r.id, i, { title: e.target.value }))} /></div>
                      <div className="field"><label className="small muted" htmlFor={`st-h-${i}`}>{t("rm.hours")}</label><input id={`st-h-${i}`} className="input" inputMode="numeric" defaultValue={s.hours} onBlur={(e) => Number(e.target.value) !== s.hours && run(() => editStage(r.id, i, { hours: Number(e.target.value) }))} /></div>
                    </div>
                    {[["rm.grammar", s.grammar], ["rm.vocab", s.vocabulary], ["rm.can", s.skills]].map(([k, list]) => (list as string[]).length > 0 && (
                      <div key={k as string} className="mt-2 small"><b>{t(k as "rm.grammar")}:</b> {(list as string[]).join(" · ")}</div>
                    ))}
                  </details>
                ))}
              </div>
              {r.criteria.length > 0 && <><h4 className="mb-1 mt-4">{t("rm.criteria")}</h4><ul className="m-0 pl-5 small">{r.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
              <div className="mt-4 flex flex-wrap gap-2">
                {r.approved ? <button className="btn secondary" disabled={pending} onClick={() => run(() => approveRoadmap(r.id, false))}>{t("rm.unapprove")}</button>
                  : <button className="btn primary" disabled={pending} onClick={() => run(() => approveRoadmap(r.id))}><Icon name="check" size="sm" />{t("rm.approve")}</button>}
              </div>
              <p className="hint mb-0 mt-3">{t("rm.approveHint")}</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
