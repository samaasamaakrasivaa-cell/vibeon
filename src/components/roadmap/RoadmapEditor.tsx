"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { useAssignParts } from "../placement/AssignParts";
import { ExpectField, Steps, TrackField, trackForAge, type PlTrack } from "../placement/PlacementPanel";
import type { RouteAi } from "@/lib/roadmap/progress";
import { approveRoadmap, assignTest, deleteCheckpoint, editStage, manualResults, type RoadmapForm } from "@/lib/roadmap/actions";
import { buildRoadmap, markStage, saveCheckpoint, saveDraftFields, saveMeta, savePace, saveSelf, type Brief, type ChatMsg, type InsightSaved, type RoadmapMeta } from "@/lib/roadmap/ai-route";
import { SHARE_DEFAULT, type Checkpoint, type Share } from "@/lib/ai/route-core";
import type { Point } from "@/lib/ai/route-core";
import { BriefForm, InsightCard, PointCard, Rich, RouteChat, StepHead, toItems, useBrief } from "./RouteBrief";
import { segName, LEVELS, ROUTE_TYPES, SKILL_COLOR, SKILL_NAME, SKILLS, txt, type Skill } from "@/lib/roadmap/cefr";
import { etaRange, fmtHM, PACES, paceKey, paceLabel, parsePace } from "@/lib/roadmap/math";
import { useRun } from "../courses/useRun";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { Mountain } from "./Mountain";
import { TestPackView } from "./TestPack";
import { SelfPlan } from "./SelfPlan";
import { Dossier } from "./Dossier";
import type { DossierTopic, SummaryView } from "@/lib/lessons/dossier";
import { selfBudget } from "@/lib/roadmap/math";
import type { AccountStats, TestPack } from "@/lib/roadmap/pack";

export type CP = { id: string; kind: string; status: string; source: string; level: string | null; skills: Partial<Record<Skill, number>>; weak: [string, string][]; takenAt: string | null; assignedAt: string; stage: number | null; placement?: string | null; pstatus?: string | null };
export type EditorData = {
  studentId: string; first: string; ini: string; level: string | null; age?: number | null; teenAvail?: boolean;
  courses: { id: string; title: string; units: number }[];
  pack?: TestPack | null; stats?: AccountStats; schedPerWeek?: number | null;
  dossier?: { threshold: number; topics: DossierTopic[]; summaries: SummaryView[]; words: string[] }; noSummary?: { id: string; date: string; title: string }[];
  checkpoints: CP[];
  roadmap: null | {
    id: string; type: string; goal: string; fromLevel: string | null; deadline: string | null; showDate: boolean; pace: string; mood: string; note: string;
    courseIds: string[]; leadCourseId: string | null; approved: boolean; built: boolean; summary: string | null; ai: RouteAi | null;
    stages: { lvl: string; title: string; hours: number; grammar: string[]; vocabulary: string[]; skills: string[]; passed: boolean; focus: string[]; checkpoint: Checkpoint | null; weeks: number | null; kind: "gaps" | "consolidate" | "level" | null; sum: string; points: Point[]; canDone: number[] }[];
    brief: Brief; insight: InsightSaved | null; chat: ChatMsg[]; versions: { at: string; note: string }[]; meta: RoadmapMeta | null;
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

function Checkpoints({ d, oralFocus }: { d: EditorData; oralFocus?: React.ReactNode }) {
  const { t, lang } = useT();
  const { run, pending } = useRun();
  const doneList = d.checkpoints.filter((c) => c.status === "done");
  const [i, setI] = useState(doneList.length - 1);
  const [manual, setManual] = useState(false);
  const [asg, setAsg] = useState(false);
  const ap = useAssignParts(asg ? d.studentId : null);
  const [exp, setExp] = useState("");
  const [track, setTrack] = useState<PlTrack>(d.teenAvail ? trackForAge(d.age) : "adult");
  const [m, setM] = useState<{ level: string; skills: Record<string, string> }>({ level: d.level ?? "B1", skills: {} });
  const open = d.checkpoints.find((c) => c.status === "assigned" || c.status === "review");
  const c = doneList[Math.max(0, Math.min(i, doneList.length - 1))];
  const prev = doneList[doneList.indexOf(c) - 1];
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <section className="card">
      <StepHead n={1} title={c ? (c.kind === "entry" ? t("rm.entry") : t("rm.slice")) : t("rm.entry")} sub={t("rm2.resSub")} right={doneList.length > 1 && <>
          <button className="iconbtn" disabled={doneList.indexOf(c) === 0} onClick={() => setI(doneList.indexOf(c) - 1)} aria-label={t("rm.prevTest")}><Icon name="chevl" size="sm" /></button>
          <span className="small muted">{doneList.indexOf(c) + 1} / {doneList.length}</span>
          <button className="iconbtn" disabled={doneList.indexOf(c) === doneList.length - 1} onClick={() => setI(doneList.indexOf(c) + 1)} aria-label={t("rm.nextTest")}><Icon name="right" size="sm" /></button>
        </>} />
      {c ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2"><span className="lvlbig">{c.level}</span><span className="small muted">{c.takenAt ? new Date(c.takenAt).toLocaleDateString(loc, { day: "numeric", month: "long" }) : ""} · {c.source === "manual" ? t("rm.manual") : t("rm.byTest")}</span></div>
          <SkillBars skills={c.skills} prev={prev?.skills} />
          {c.weak.length > 0 && <div className="mt-3 small"><b>{t("rm.weak")}:</b> {c.weak.map((w) => txt(w, lang)).join(", ")}</div>}
        </>
      ) : <p className="hint mt-0">{t("rm.noTest")}</p>}
      {open && (
        <div className="alert calm mt-3 flex flex-wrap items-center gap-2"><Icon name="hourglass" size="sm" />
          <span className="grow">{open.status === "review" ? t("pl.toReview") : open.pstatus === "active" ? t("pl.studentTaking") : open.kind === "entry" ? t("rm.entryAssigned") : t("rm.sliceAssigned")}</span>
          {open.placement && open.status === "review" && <a className="btn primary sm" href={`/teacher/placement/${open.placement}`}>{t("pl.review")}</a>}
        </div>
      )}
      {c?.placement && <a className="small alink mt-2 inline-block" href={`/teacher/placement/${c.placement}`}>{t("pl.openResult")}</a>}
      {oralFocus}
      <div className="mt-4 flex flex-wrap gap-2">
        {/* placement test можно назначить и после первого — по разделам: добавить новые или повторить для сравнения */}
        <button className={`btn ${doneList.length ? "secondary" : "primary"} sm`} disabled={pending} onClick={() => setAsg(true)}>{t("rm.assignEntry")}</button>
        {doneList.length > 0 && <button className="btn secondary sm" disabled={pending} onClick={() => run(() => assignTest(d.studentId, "slice", d.roadmap?.ci ?? 0))}>{t("rm.assignSlice")}</button>}
        <button className="btn plain sm" onClick={() => setManual(true)}>{t("rm.enterManual")}</button>
        {c && <button className="btn plain sm" onClick={() => { if (confirm(t("rm.delTest"))) run(() => deleteCheckpoint(c.id)); }}>{t("common.delete")}</button>}
      </div>
      <Dialog open={asg} onClose={() => setAsg(false)} title={t("rm.assignEntry")}>
        {ap.ui}
        {d.teenAvail && !ap.useInto && <TrackField value={track} onChange={setTrack} age={d.age} />}
        {!ap.useInto && <ExpectField value={exp} onChange={setExp} teen={track === "teen"} need={ap.needLevel} />}
        <Steps keys={["pl.assignS2", "pl.assignS3", "pl.assignS4"]} tip="pl.assignTip" />
        <div className="actions"><button className="btn secondary" onClick={() => setAsg(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending || ap.blocked(exp)} onClick={() => run(() => ap.submit(exp, track), () => { setAsg(false); ap.reset(); })}>{ap.useInto ? t("pl.partsAddDo") : t("pl.assignDo")}</button></div>
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

const KIND_PILL: Record<string, string> = { gaps: "orange", consolidate: "blue", level: "violet" };
const KIND_KEY = { gaps: "rm2.segGaps", consolidate: "rm2.segCons", level: "rm2.segLevel" } as const;
/** Текст ИИ → по предложениям (для списка с точками). */
const sentences = (x: string) => x.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z0-9«"(])/).map((y) => y.trim()).filter(Boolean);

const SKILL_RU: Record<string, string> = { grammar: "грамматика", vocabulary: "лексика", grammar_vocab: "грамматика и лексика", reading: "чтение", listening: "аудирование", writing: "письмо", speaking: "говорение" };

/** Контрольный срез участка: что проверяем, формат, правило прохода, что если не прошёл. Учитель правит и утверждает. */
function CheckpointCard({ id, i, cp, last }: { id: string; i: number; cp: Checkpoint; last: boolean }) {
  const { t } = useT();
  const { run, pending, error } = useRun();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ what: (cp.what ?? []).join("\n"), format: cp.format ?? "", pass_rule: cp.pass_rule ?? "", if_not_passed: cp.if_not_passed ?? "" });
  const save = (approved: boolean) => run(() => saveCheckpoint(id, i, { what: v.what.split(/\n+/), format: v.format, pass_rule: v.pass_rule, if_not_passed: v.if_not_passed, approved }), () => setEdit(false));
  return (
    <div className={`cpcard ${cp.approved ? "ok" : ""}`}>
      <div className="cp-h"><span className="cp-ico">⚑</span><b className="grow">{last ? t("rm5.cpFinal") : t("rm5.cp")}</b>
        {cp.approved ? <span className="pill green"><Icon name="check" size="sm" />{t("rm5.cpOk")}</span> : <span className="pill orange">{t("rm5.cpDraft")}</span>}
      </div>
      {cp.tests.length > 0 && <div className="flex flex-wrap gap-1.5">{cp.tests.map((x) => <span key={x} className="pill grey">{SKILL_RU[x] ?? x}</span>)}</div>}
      {edit ? (
        <div className="flex flex-col gap-2">
          <label className="small font-bold">{t("rm5.what")}<textarea className="textarea mt-1" rows={3} value={v.what} placeholder={t("rm4.linePh")} onChange={(e) => setV({ ...v, what: e.target.value })} /></label>
          <label className="small font-bold">{t("rm5.format")}<input className="input mt-1" value={v.format} onChange={(e) => setV({ ...v, format: e.target.value })} /></label>
          <label className="small font-bold">{t("rm5.rule")}<input className="input mt-1" value={v.pass_rule} onChange={(e) => setV({ ...v, pass_rule: e.target.value })} /></label>
          <label className="small font-bold">{t("rm5.ifNot")}<input className="input mt-1" value={v.if_not_passed} onChange={(e) => setV({ ...v, if_not_passed: e.target.value })} /></label>
        </div>
      ) : (
        <dl className="cp-dl">
          {(cp.what ?? []).length > 0 && <><dt>{t("rm5.what")}</dt><dd><ul className="ins-ul">{cp.what!.map((x, k) => <li key={k}><Rich text={x} /></li>)}</ul></dd></>}
          {cp.format && <><dt>{t("rm5.format")}</dt><dd>{cp.format}</dd></>}
          {cp.pass_rule && <><dt>{t("rm5.rule")}</dt><dd><b>{cp.pass_rule}</b></dd></>}
          {cp.if_not_passed && <><dt>{t("rm5.ifNot")}</dt><dd>{cp.if_not_passed}</dd></>}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {edit ? <>
          <button className="btn primary sm" disabled={pending} onClick={() => save(true)}><Icon name="check" size="sm" />{t("rm5.saveOk")}</button>
          <button className="btn secondary sm" disabled={pending} onClick={() => save(!!cp.approved)}>{t("common.save")}</button>
        </> : <>
          {!cp.approved && <button className="btn primary sm" disabled={pending} onClick={() => save(true)}><Icon name="check" size="sm" />{t("rm5.approve")}</button>}
          <button className="btn plain sm" onClick={() => setEdit(true)}><Icon name="pencil" size="sm" />{t("rm2.fix")}</button>
          {cp.approved && <button className="btn plain sm" disabled={pending} onClick={() => save(false)}>{t("rm5.unapprove")}</button>}
        </>}
      </div>
      {error && <div className="alert">{error}</div>}
    </div>
  );
}

/** Блок предпостроенного маршрута, который учитель может править: пункты списком (точки или номера), правка — пункт на строку. */
function EditSec({ title, items, numbered, onSave, text }: { title: string; items: string[]; numbered?: boolean; onSave: (v: string[]) => Promise<{ ok: boolean; error?: string } | unknown>; text?: boolean }) {
  const { t } = useT();
  const { run, pending, error } = useRun();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(items.join("\n"));
  useEffect(() => { if (!edit) setV(items.join("\n")); }, [items, edit]);
  const L = numbered ? "ol" : "ul";
  return (
    <div className="rsec">
      <h4 className="flex items-center gap-2"><span className="grow">{title}</span>{!edit && <button type="button" className="iconbtn" aria-label={t("rm2.fix")} title={t("rm2.fix")} onClick={() => setEdit(true)}><Icon name="pencil" size="sm" /></button>}</h4>
      {edit ? (
        <div className="flex flex-col gap-2">
          <textarea className="textarea" rows={Math.max(3, items.length + 1)} value={v} placeholder={text ? "" : t("rm4.linePh")} onChange={(e) => setV(e.target.value)} />
          <div className="flex gap-2"><button className="btn primary sm" disabled={pending} onClick={() => run(async () => (await onSave(text ? [v.trim()] : v.split(/\n+/).map((x) => x.trim()).filter(Boolean))) as never, () => setEdit(false))}>{t("common.save")}</button><button className="btn secondary sm" onClick={() => setEdit(false)}>{t("common.cancel")}</button></div>
          {error && <div className="alert">{error}</div>}
        </div>
      ) : text ? <p className="rquote">{items[0]}</p> : items.length ? <L className={numbered ? "rnum" : "rbul"}>{items.map((x, i) => <li key={i}><Rich text={x} /></li>)}</L> : <span className="hint">{t("rm6.empty")}</span>}
    </div>
  );
}

/** Варианты темпа с расшифровкой: уроки по расписанию + минуты в день → примерно за сколько недель и к какому месяцу. Учитель выбирает. */
function PaceOptions({ id, pace, left, lessonMin }: { id: string; pace: string; left: number; lessonMin: number }) {
  const { t, lang } = useT();
  const { run, pending } = useRun();
  const cur = parsePace(pace);
  const rec = selfBudget(cur.lessons, lessonMin).minPerDay;
  const mins = [...new Set([10, 15, 20, rec, 30, 40, cur.min])].sort((a, b) => a - b);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <div className="rsec">
      <h4>{t("rm6.pace")}</h4>
      <div className="paceopts">
        {mins.map((m) => {
          const wk = Math.max(1, Math.round(left / ((cur.lessons * lessonMin) / 60 + (m * 7) / 60)));
          const d = new Date(Date.now() + wk * 7 * 864e5).toLocaleDateString(loc, { month: "long", year: "numeric" });
          const on = m === cur.min;
          return (
            <button key={m} type="button" className={`paceopt ${on ? "on" : ""}`} disabled={pending} aria-pressed={on} onClick={() => !on && run(() => savePace(id, `${cur.lessons}:${m}`))}>
              <span className="po-a">{t("rm6.paceA", { l: cur.lessons, m })}</span>
              <span className="po-b">{t("rm6.paceB", { w: wk, d })}</span>
              {m === rec && <span className="pill blue">{t("rm6.rec")}</span>}
              {on && <span className="pill green">{t("rm6.chosen")}</span>}
            </button>
          );
        })}
      </div>
      <span className="hint">{t("rm6.paceHint")}</span>
    </div>
  );
}

/** Критерии достижения цели: нумерованный список, учитель отмечает выполненные. */
function Criteria({ id, items, done }: { id: string; items: string[]; done: number[] }) {
  const [edit, setEdit] = useState(false);
  if (edit) return <EditSec title={useT().t("rm.criteria")} items={items} numbered onSave={async (v) => { const r = await saveDraftFields(id, { criteria: v }); setEdit(false); return r; }} />;
  return <CriteriaView id={id} items={items} done={done} onEdit={() => setEdit(true)} />;
}
function CriteriaView({ id, items, done, onEdit }: { id: string; items: string[]; done: number[]; onEdit: () => void }) {
  const { t } = useT();
  const { run } = useRun();
  const [loc, setLoc] = useState(done);
  const set = new Set(loc);
  return (
    <div className="rsec">
      <h4 className="flex items-center gap-2"><span className="grow">{t("rm.criteria")}</span><span className="crit-n">{t("rm4.critDone", { a: set.size, b: items.length })}</span><button type="button" className="iconbtn" aria-label={t("rm2.fix")} title={t("rm2.fix")} onClick={onEdit}><Icon name="pencil" size="sm" /></button></h4>
      <div className="crit-bar"><span style={{ width: `${items.length ? (set.size / items.length) * 100 : 0}%` }} /></div>
      <ol className="crit">
        {items.map((c, i) => (
          <li key={i} className={set.has(i) ? "on" : ""}>
            <label><input type="checkbox" checked={set.has(i)} onChange={(e) => { const n = new Set(set); if (e.target.checked) n.add(i); else n.delete(i); setLoc([...n]); run(() => saveMeta(id, { done: [...n] })); }} />
              <span className="crit-i">{i + 1}</span><span className="grow"><Rich text={c} /></span></label>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** «Что увидит ученик»: карта всегда; остальное — галочками (ИИ предлагает, учитель решает). */
function ShareBox({ id, share, hasSelf, hasMsg }: { id: string; share: Share; hasSelf: boolean; hasMsg: boolean }) {
  const { t } = useT();
  const { run, pending } = useRun();
  const [s, setS] = useState(share);
  const toggle = (k: keyof Share) => { const n = { ...s, [k]: !s[k] }; setS(n); run(() => saveMeta(id, { share: n })); };
  const rows: [keyof Share | "map", string, boolean][] = [["map", t("rm4.shMap"), true], ["gaps", t("rm4.shGaps"), true], ["self", t("rm4.shSelf"), hasSelf], ["criteria", t("rm4.shCrit"), true], ["message", t("rm4.shMsg"), hasMsg]];
  return (
    <div className="rsec">
      <h4>{t("rm4.share")}</h4>
      <div className="shbox">
        {rows.filter((x) => x[2]).map(([k, label]) => (
          <label key={k} className={`shrow ${k === "map" || s[k as keyof Share] ? "on" : ""}`}>
            <input type="checkbox" checked={k === "map" || !!s[k as keyof Share]} disabled={k === "map" || pending} onChange={() => k !== "map" && toggle(k as keyof Share)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <span className="hint">{t("rm4.shareHint")}</span>
    </div>
  );
}

export function RoadmapEditor({ d, oralFocus }: { d: EditorData; oralFocus?: React.ReactNode }) {
  const { t, lang } = useT();
  const { run, pending, error } = useRun();
  const r = d.roadmap;
  const lastTest = [...d.checkpoints].reverse().find((c) => c.status === "done");
  const [f, setF] = useState<RoadmapForm>({
    type: r?.type ?? "ge", goal: r?.goal ?? "", fromLevel: r?.fromLevel ?? lastTest?.level ?? d.level?.match(/[ABC][12]\+?/)?.[0] ?? "",
    courseIds: r?.courseIds ?? [], leadCourseId: r?.leadCourseId ?? null, deadline: r?.deadline ?? null, showDate: r?.showDate ?? false,
    pace: r?.pace ?? (d.schedPerWeek ? `${Math.min(5, d.schedPerWeek)}:20` : "2:20"), mood: r?.mood ?? "plan", note: r?.note ?? "",
  });
  const goals = ROUTE_TYPES[f.type]?.goals ?? [];
  const goal = goals.includes(f.goal) ? f.goal : goals[Math.min(goals.length - 1, f.type === "ge" ? 5 : 0)];
  const [sel, setSel] = useState<number | undefined>(undefined);
  const [pt, setPt] = useState<string | null>(null);
  const { brief, setBrief, saved } = useBrief(d.studentId, { ...f, goal }, r?.brief ?? {});
  const allPoints = (r?.stages ?? []).flatMap((s) => s.points);
  const point = pt ? allPoints.find((p) => p.id === pt) ?? null : null;
  const blk = (title: string, children: React.ReactNode) => <div className="dblk"><div className="small mb-2 font-bold text-text2">{title}</div>{children}</div>;

  return (
    <div className="rmgrid">
      <div className="flex flex-col gap-4">
        <Checkpoints d={d} oralFocus={oralFocus} />
        {d.stats && <TestPackView pack={d.pack ?? null} stats={d.stats} />}
        {d.dossier && (d.dossier.summaries.length > 0 || (d.noSummary?.length ?? 0) > 0) && <Dossier studentId={d.studentId} {...d.dossier} noSummary={d.noSummary ?? []} />}
        {d.stats && <InsightCard studentId={d.studentId} f={{ ...f, goal }} brief={brief} insight={r?.insight ?? null} hasPack={!!d.pack} />}
        <section className="card flex flex-col gap-4">
          <StepHead n={4} title={t("rm.data")} sub={t("rm2.dataSub")} />
          {blk(t("rm.type"), <div className="flex flex-wrap gap-1.5">{Object.entries(ROUTE_TYPES).map(([k, v]) => <button key={k} type="button" className={`pchip ${f.type === k ? "on" : ""}`} aria-pressed={f.type === k} onClick={() => setF({ ...f, type: k, goal: "" })}>{txt(v.name, lang)}</button>)}</div>)}
          <div className="grid grid-cols-2 gap-3">
            <div className="field"><label htmlFor="rm-from">{t("rm.from")}</label><select id="rm-from" className="select" value={f.fromLevel} onChange={(e) => setF({ ...f, fromLevel: e.target.value })}><option value="">{t("rm.fromTest")}</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></div>
            <div className="field"><label htmlFor="rm-goal">{t("rm.goal")}</label><select id="rm-goal" className="select" value={goal} onChange={(e) => setF({ ...f, goal: e.target.value })}>{goals.map((g) => <option key={g}>{g}</option>)}</select></div>
          </div>
          <details className="rrub rcourses">
            <summary><span className="grow"><span className="small font-bold text-text2">{t("rm.courses")}</span><span className="block font-normal">{f.courseIds.length ? `${d.courses.find((c) => c.id === f.leadCourseId)?.title ?? d.courses.find((c) => c.id === f.courseIds[0])?.title ?? ""}${f.leadCourseId ? ` · ${t("rm.lead")}` : ""}${f.courseIds.length > 1 ? ` +${f.courseIds.length - 1}` : ""}` : <span className="muted">{t("rm2.noCourse")}</span>}</span></span><Icon name="chevd" size="sm" /></summary>
            <div className="rrub-body">
              {d.courses.length ? (
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
              ) : <span className="hint">{t("rm.noCourses")}</span>}
            </div>
          </details>
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
            <div className="field">
              <span className="flabel">{t("rm2.perWeek")}</span>
              <div className="seg" role="group" aria-label={t("rm2.perWeek")}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-pressed={parsePace(f.pace).lessons === n} onClick={() => setF({ ...f, pace: `${n}:${parsePace(f.pace).min}` })}>{n}</button>)}</div>
              <span className="hint">{d.schedPerWeek ? t("rm2.bySched", { n: d.schedPerWeek }) : t("rm2.noSched")}</span>
            </div>
            <div className="field"><span className="flabel">{t("rm.mood")}</span><div className="seg">{(["plan", "more", "slack"] as const).map((k) => <button key={k} type="button" aria-pressed={f.mood === k} onClick={() => setF({ ...f, mood: k })}>{t(`rm.mood.${k}`)}</button>)}</div></div>
          </div>
        </section>
        <BriefForm brief={brief} setBrief={setBrief} saved={saved} />
        <section className="card flex flex-col gap-2">
          <StepHead n={6} title={t("rm2.buildT")} sub={t("rm2.buildSub")} />
          {error && <div className="alert">{error}</div>}
          <button className="btn primary lg w-full" disabled={pending} onClick={() => run(() => buildRoadmap(d.studentId, { ...f, goal }, brief))}><Icon name="spark" />{pending ? t("rm2.building") : r?.built ? t("rm.rebuild") : t("rm2.build")}</button>
          {pending && <span className="hint text-center">{t("rm2.buildWait")}</span>}
        </section>
      </div>

      <div className="flex flex-col gap-4">
        {!r?.built ? (
          <section className="card rtempty"><Icon name="spark" /><div><b>{t("rm.emptyTitle")}</b><div className="small muted">{t("rm.emptySub")}</div></div></section>
        ) : (
          <>
            <section className="card">
              <StepHead n="★" ai title={t("rm2.preTitle")} sub={`${r.fromLevel ?? ""} → ${r.goal}`} right={<>
                {r.approved ? <span className="pill green"><Icon name="check" size="sm" />{t("rm.approved")}</span> : <span className="pill orange"><Icon name="spark" size="sm" />{t("rm.draft")}</span>}
                {r.approved && r.lateWeeks > 0 && <span className="pill red">{t("rm.late", { n: r.lateWeeks })}</span>}
              </>} />
              <dl className="kv mt-3">
                <dt>{t("rm2.perWeek")}</dt><dd>{parsePace(r.pace).lessons}</dd>
                <dt>{t("rm.eta")}</dt><dd><b>{r.deadline && r.showDate ? etaRange(r.left, parsePace(r.pace), lang, r.lessonMin) : t("rm.hoursLeft", { n: Math.round(r.left) })}</b>{r.deadline && !r.showDate && <> · {etaRange(r.left, parsePace(r.pace), lang, r.lessonMin)} <span className="pill grey">{t("rm.onlyYou")}</span></>}{!r.deadline && <span className="small muted"> · ≈ {etaRange(r.left, parsePace(r.pace), lang, r.lessonMin)}</span>}</dd>
                <dt>{t("rm.course")}</dt><dd>{r.leadCourseId ? `${d.courses.find((c) => c.id === r.leadCourseId)?.title ?? "—"}, ${t("rm.nUnits", { n: r.units.length })}` : <span className="muted">{t("rm.noLead")}</span>}</dd>
                <dt>{t("rm.done")}</dt><dd>{fmtHM(r.done, lang)}</dd>
              </dl>
              {r.ai?.changes && <div className="alert calm mt-3"><b>{t("rm2.changes")}:</b> {r.ai.changes}</div>}
              <EditSec title={t("rm2.mainIdea")} numbered items={toItems(r.summary ?? "")} onSave={(v) => saveDraftFields(r.id, { summary: v.join("\n") })} />
              {r.stages.length > 0 && (
                <div className="rsec"><h4>{t("rm2.plan")}</h4>
                  <div className="segtbl">{r.stages.map((s, i) => (
                    <div key={i} className="segrow"><span className="segn">{i + 1}</span><b className="segname">{segName(r.stages, i, r.fromLevel)}</b><span className={`pill ${KIND_PILL[s.kind ?? "level"]} segkind`}>{t(KIND_KEY[s.kind ?? "level"])}</span><span className="seghrs"><b>{s.hours} {t("rm.h")}</b>{s.weeks ? <span>{t("rm.aiWeeks", { n: s.weeks })}</span> : null}</span><span className="segpts">{s.points.length > 0 ? t("rm2.nPoints", { n: s.points.length }) : ""}</span></div>
                  ))}</div>
                  {r.ai?.total_hours ? <div className="small mt-1"><b>{t("rm.aiTotal", { h: Math.round(r.ai.total_hours), w: r.ai.forecast_weeks ?? "—" })}</b></div> : null}
                </div>
              )}
              {r.ai && (
                <>
                  {r.ai.deadline_check && <div className={`alert ${r.ai.deadline_check.fits ? "ok" : ""} mt-3`}><b>{r.ai.deadline_check.fits ? t("rm.aiFits") : t("rm.aiNoFit")}</b>{r.ai.deadline_check.note ? ` ${r.ai.deadline_check.note}` : ""}</div>}
                  <EditSec title={t("rm.aiGaps")} numbered items={r.ai.start?.gaps ?? []} onSave={(v) => saveDraftFields(r.id, { gaps: v })} />
                  <EditSec title={t("rm.aiRisks")} items={r.ai.risks} onSave={(v) => saveDraftFields(r.id, { risks: v })} />
                  <PaceOptions id={r.id} pace={r.pace} left={r.left || r.ai.total_hours || 0} lessonMin={r.lessonMin} />
                  {r.ai.self_study && <div className="rsec"><h4>{t("ss.title")}</h4><SelfPlan plan={r.ai.self_study} lessons={parsePace(r.pace).lessons} lessonMin={r.lessonMin} onSave={(items, tips) => saveSelf(r.id, items, tips)} /></div>}
                  <EditSec title={t("rm.aiStudentMsg")} text items={[r.ai.student_message ?? ""]} onSave={(v) => saveDraftFields(r.id, { message: v[0] ?? "" })} />
                  <div className="small muted mt-3">{t("rm.aiBy", { m: r.ai.label })}{r.ai.fallbackFrom ? ` · ${t("air.fallback")}` : ""}</div>
                </>
              )}
            </section>
            <div className="mtnwrap"><Mountain stages={r.stages} done={r.done} start={r.fromLevel ?? "A"} ini={d.ini} label={t("rm.isHere", { name: d.first })} units={r.units} ci={r.ci} sel={sel} onSelect={setSel} onPoint={(id) => setPt(id)} selPoint={pt} /></div>
            {point && <PointCard key={point.id} roadmapId={r.id} p={point} onClose={() => setPt(null)} happiful={/happ?[iy]ful/i.test(brief.materials ?? "")} />}
            <section className="card">
              <h3 className="mt-0">{t("rm.stages")}</h3>
              <div className="flex flex-col gap-2">
                {r.stages.map((s, i) => (
                  <details key={i} className={`stagerow ${i === r.ci ? "cur" : ""}`} open={sel === i || r.stages.length <= 2} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setSel(i)}>
                    <summary className="segrow"><span className="segn">{i + 1}</span><b className="segname">{segName(r.stages, i, r.fromLevel)}{s.passed && <span className="pill green ml-2">✓</span>}</b><span className={`pill ${KIND_PILL[s.kind ?? "level"]} segkind`}>{t(KIND_KEY[s.kind ?? "level"])}</span><span className="seghrs"><b>{s.hours} {t("rm.h")}</b>{s.weeks ? <span>{t("rm.aiWeeks", { n: s.weeks })}</span> : null}</span></summary>
                    {s.sum && <p className="small mb-0 mt-2">{s.sum}</p>}
                    {s.points.length > 0 ? (
                      <ol className="rpts">
                        {(() => { let c = r.stages.slice(0, i).reduce((a, x) => a + x.hours, 0); return s.points.map((p) => { c += p.hours; return { p, auto: r.done >= c - 0.01 }; }); })().map(({ p, auto }) => (
                          <li key={p.id} className={`${pt === p.id ? "sel" : ""} ${(p.done ?? auto) ? "done" : ""}`}>
                            <input type="checkbox" className="pt-chk" key={`${p.id}-${String(p.done ?? auto)}`} defaultChecked={p.done ?? auto} title={p.done === undefined ? t("rm6.autoHint") : t("rm6.manualHint")} aria-label={t("rm6.mastered")} onChange={(e) => run(() => markStage(r.id, i, { pointId: p.id, done: e.target.checked === auto ? null : e.target.checked }))} />
                            <button type="button" onClick={() => setPt(p.id)}>
                              <span className="grow"><b>{p.title}</b>{p.focus && <span className="small muted block">{p.focus}</span>}</span>
                              {p.ok && Object.keys(p.ok).length > 0 && <span className="pill green" title={t("mtn.okT")}>✓</span>}
                              <span className="small muted nowrap text-right">{p.hours} {t("rm.h")}{p.hours_why && <span className="block hwhy">{p.hours_why}</span>}</span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <div className="field"><label className="small muted" htmlFor={`st-t-${i}`}>{t("crs.title")}</label><input id={`st-t-${i}`} className="input" defaultValue={s.title} onBlur={(e) => e.target.value !== s.title && run(() => editStage(r.id, i, { title: e.target.value }))} /></div>
                          <div className="field"><label className="small muted" htmlFor={`st-h-${i}`}>{t("rm.hours")}</label><input id={`st-h-${i}`} className="input" inputMode="numeric" defaultValue={s.hours} onBlur={(e) => Number(e.target.value) !== s.hours && run(() => editStage(r.id, i, { hours: Number(e.target.value) }))} /></div>
                        </div>
                        {[["rm.grammar", s.grammar], ["rm.vocab", s.vocabulary]].map(([k, list]) => (list as string[]).length > 0 && (
                          <div key={k as string} className="mt-2 small"><b>{t(k as "rm.grammar")}:</b> {(list as string[]).join(" · ")}</div>
                        ))}
                        {s.focus.length > 0 && <div className="mt-2 small"><b>{t("rm.aiFocus")}:</b> {s.focus.join(" · ")}</div>}
                      </>
                    )}
                    {s.skills.length > 0 && (
                      <div className="mt-3"><div className="small font-bold">{t("rm6.canT")}</div>
                        <ul className="cancheck">{s.skills.map((x, k) => { const on = s.canDone.includes(k); return <li key={k} className={on ? "on" : ""}><label><input type="checkbox" key={`${k}-${on}`} defaultChecked={on} onChange={(e) => run(() => markStage(r.id, i, { can: e.target.checked ? [...s.canDone, k] : s.canDone.filter((y) => y !== k) }))} /><span><Rich text={x} /></span></label></li>; })}</ul>
                      </div>
                    )}
                    {s.checkpoint && <CheckpointCard id={r.id} i={i} cp={s.checkpoint} last={i === r.stages.length - 1} />}
                  </details>
                ))}
              </div>
              {r.criteria.length > 0 && <Criteria id={r.id} items={r.criteria} done={r.meta?.done ?? []} />}
              <ShareBox id={r.id} share={r.meta?.share ?? SHARE_DEFAULT} hasSelf={!!r.ai?.self_study} hasMsg={!!r.ai?.student_message} />
              <div className="mt-4 flex flex-wrap gap-2">
                {r.approved ? <button className="btn secondary" disabled={pending} onClick={() => run(() => approveRoadmap(r.id, false))}>{t("rm.unapprove")}</button>
                  : <button className="btn primary" disabled={pending} onClick={() => run(() => approveRoadmap(r.id))}><Icon name="check" size="sm" />{t("rm.approve")}</button>}
              </div>
              <p className="hint mb-0 mt-3">{t("rm.approveHint")}</p>
            </section>
            <RouteChat roadmapId={r.id} chat={r.chat} versions={r.versions} />
          </>
        )}
      </div>
    </div>
  );
}
