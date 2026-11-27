"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { KIND, STUDY_KINDS, type StudyKind } from "@/lib/study/kinds";
import { addSlot, markSlot, moveSlot, removeSlot, setWordsTime, updateSlot, type SlotInput } from "@/lib/study/actions";
import type { Occ } from "@/lib/study/data";
import type { StudyRecommendation } from "@/lib/study/weekly-plan";

export type StudyProps = {
  occ: Occ[]; planned: number; done: number; target: number | null;
  recs: { kind: StudyKind; title: string | null; why: string }[];
  words: { days: number[]; at: string; goal: number } | null;
  recommendation: StudyRecommendation | null;
  studentId?: string; teacher?: boolean; hwLink?: string | null; today: string;
};
type DayInfo = { iso: string; dow: string; long: string; past: boolean };

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const DURS = [10, 15, 20, 30, 45, 60, 90, 120];
const ADDABLE = STUDY_KINDS.filter((k) => k !== "words");

/** Блоки своих слотов в колонке дня: цвет по виду, сделанное — с галочкой, прошедшее без отметки — пунктиром. */
export function SlotBlocks({ occ, day, hourFrom, px, busyRanges, onOpen }: { occ: Occ[]; day: number; hourFrom: number; px: number; busyRanges: [number, number][]; onOpen: (o: Occ) => void }) {
  const { t } = useT();
  return <>{occ.filter((o) => o.day === day).map((o) => {
    // рядом с уроком — в правую половину колонки, чтобы не перекрывать
    const half = busyRanges.some(([a, b]) => o.startMin < b && o.startMin + o.dur > a);
    const k = KIND[o.kind];
    return (
      <button key={o.key} type="button" className={`sslot ${o.status} ${half ? "half" : ""}`} data-kind={o.kind}
        style={{ top: ((o.startMin - hourFrom * 60) / 60) * px + 1.5, height: Math.max(20, (o.dur / 60) * px - 3), ["--k" as string]: k.color }}
        title={`${hm(o.startMin)}–${hm(o.startMin + o.dur)} · ${o.title ?? t(`st.k.${o.kind}` as DictKey)}`} onClick={(e) => { e.stopPropagation(); onOpen(o); }}>
        <span className="nm"><Icon name={o.status === "done" ? "check" : k.icon} size="sm" />{o.title ?? t(`st.k.${o.kind}` as DictKey)}</span>
        {o.dur >= 55 && <span className="tm">{hm(o.startMin)}</span>}
      </button>
    );
  })}</>;
}

/** Окно нового слота или правки: вид, название, день (каждую неделю или дата), время, длительность, напоминание. */
export function SlotForm({ init, days, onClose, studentId, slotId, words, teacher, onAskLesson }: { init: Partial<SlotInput> & { kind: StudyKind }; days: DayInfo[]; onClose: () => void; studentId?: string; slotId?: string; words?: StudyProps["words"]; teacher?: boolean; onAskLesson?: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [f, setF] = useState<SlotInput>({ title: "", repeat: true, weekday: 0, startMin: 19 * 60, durMin: KIND[init.kind].dur, remind: true, ...init, kind: init.kind } as SlotInput);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (p: Partial<SlotInput>) => setF((x) => ({ ...x, ...p }));
  const save = () => start(async () => {
    setErr(null);
    const r = slotId ? await updateSlot(slotId, f, studentId) : await addSlot(f, studentId);
    if (!r.ok) { setErr(t("st.err")); return; }
    router.refresh(); onClose();
  });
  return (
    <Dialog open onClose={onClose} title={slotId ? t("st.edit") : teacher ? t("st.addFor") : t("st.add")}>
      <div className="flex flex-col gap-4">
        <div className="stkinds" role="radiogroup" aria-label={t("st.kind")}>
          {ADDABLE.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={f.kind === k} className={`stkind ${f.kind === k ? "on" : ""}`} style={{ ["--k" as string]: KIND[k].color }}
              onClick={() => set({ kind: k, durMin: f.kind === k ? f.durMin : KIND[k].dur })}><Icon name={KIND[k].icon} size="sm" />{t(`st.k.${k}` as DictKey)}</button>
          ))}
        </div>
        {words && <p className="small muted m-0"><Icon name="cards" size="sm" /> {t("st.wordsNote", { at: words.at, n: words.goal })}</p>}
        <label className="field"><span className="flabel">{t(f.kind === "other" ? "st.otherTitle" : "st.title")}</span><input className="input" value={f.title ?? ""} required={f.kind === "other"} maxLength={80} placeholder={t(`st.ph.${f.kind}` as DictKey)} onChange={(e) => set({ title: e.target.value })} /></label>
        <div className="seg w-full" role="group" aria-label={t("st.repeat")}>
          <button type="button" className="grow" aria-pressed={f.repeat} onClick={() => set({ repeat: true })}>{t("st.weekly")}</button>
          <button type="button" className="grow" aria-pressed={!f.repeat} onClick={() => set({ repeat: false, date: f.date ?? (f.weekday !== undefined && days[f.weekday] && !days[f.weekday].past ? days[f.weekday].iso : days.find((d) => !d.past)?.iso ?? days[0].iso) })}>{t("st.once")}</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {f.repeat ? (
            <label className="field"><span className="flabel">{t("st.day")}</span>
              <select className="select" value={f.weekday ?? 0} onChange={(e) => set({ weekday: +e.target.value })}>{days.map((d, i) => <option key={d.iso} value={i}>{d.long.split(",")[0]}</option>)}</select></label>
          ) : (
            <label className="field"><span className="flabel">{t("st.date")}</span><input type="date" className="input" value={f.date ?? ""} onChange={(e) => set({ date: e.target.value })} /></label>
          )}
          <label className="field"><span className="flabel">{t("st.time")}</span><input type="time" className="input" step={300} value={hm(f.startMin)} onChange={(e) => set({ startMin: toMin(e.target.value) })} /></label>
          <label className="field"><span className="flabel">{t("st.dur")}</span>
            <select className="select" value={f.durMin} onChange={(e) => set({ durMin: +e.target.value })}>{[...new Set([...DURS, f.durMin])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} {t("dash.min")}</option>)}</select></label>
        </div>
        <label className="setting"><span>{t("st.remind")}<span className="small muted block">{t("st.remindHint")}</span></span>
          <span className="switch"><input type="checkbox" checked={f.remind} onChange={(e) => set({ remind: e.target.checked })} /><span /></span></label>
        {err && <div className="alert">{err}</div>}
        {onAskLesson && <button type="button" className="alink small self-start" onClick={onAskLesson}>{t("st.askLesson")}</button>}
      </div>
      <div className="actions"><button className="btn secondary" onClick={onClose}>{t("common.cancel")}</button><button className="btn primary" disabled={pending || (f.kind === "other" && !f.title?.trim())} onClick={save}>{t("common.save")}</button></div>
    </Dialog>
  );
}

/** Окно слота: открыть (домашка, слова), «Сделал», «Перенести», изменить, убрать. */
export function SlotDialog({ o, days, onClose, onEdit, p }: { o: Occ; days: DayInfo[]; onClose: () => void; onEdit: () => void; p: StudyProps }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mv, setMv] = useState<{ date: string; time: string } | null>(null);
  const [wt, setWt] = useState<{ time: string; days: number[] } | null>(null);
  const day = days[o.day];
  const run = (fn: () => Promise<{ ok: boolean }>) => start(async () => { const r = await fn(); if (r.ok) { router.refresh(); onClose(); } });
  const label = o.title ?? t(`st.k.${o.kind}` as DictKey);
  const canMark = !p.teacher && !!o.slotId && !o.auto && o.iso <= p.today; // будущее отметить нельзя
  return (
    <Dialog open onClose={onClose} title={label}>
      <p className="muted mt-0 mb-2"><span className="stdot" style={{ background: KIND[o.kind].color }} />{t(`st.k.${o.kind}` as DictKey)} · {day.long}, {hm(o.startMin)}–{hm(o.startMin + o.dur)}{o.repeat ? ` · ${t("st.weeklyShort")}` : ""}{o.byTeacher ? ` · ${t("st.byTeacher")}` : ""}</p>
      <p className="small m-0 mb-3">
        {o.status === "done" ? <span className="text-ok">✓ {o.auto ? t(o.kind === "words" ? "st.autoWords" : "st.autoHw") : t("st.doneMark")}</span>
          : o.status === "unmarked" ? <span className="muted">{t("st.unmarked")}</span> : <span className="muted">{t("st.open")}</span>}
      </p>
      {o.kind === "words" ? (
        wt ? (
          <div className="flex flex-col gap-3">
            <label className="field"><span className="flabel">{t("st.time")}</span><input type="time" className="input" step={300} value={wt.time} onChange={(e) => setWt({ ...wt, time: e.target.value })} /></label>
            <div className="flex flex-wrap gap-1.5">{days.map((d, i) => <button key={d.iso} type="button" className={`pchip ${wt.days.includes(i) ? "on" : ""}`} aria-pressed={wt.days.includes(i)} onClick={() => setWt({ ...wt, days: wt.days.includes(i) ? wt.days.filter((x) => x !== i) : [...wt.days, i] })}>{d.dow}</button>)}</div>
            <div className="actions"><button className="btn secondary" onClick={() => setWt(null)}>{t("common.cancel")}</button><button className="btn primary" disabled={pending || !wt.days.length} onClick={() => run(() => setWordsTime(toMin(wt.time), wt.days, p.studentId))}>{t("common.save")}</button></div>
          </div>
        ) : (
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            {!p.teacher && <Link className="btn primary" href="/student/words"><Icon name="cards" size="sm" />{t("st.trainWords")}</Link>}
            <button className="btn secondary" onClick={() => setWt({ time: p.words?.at ?? "19:00", days: p.words?.days ?? [0, 1, 2, 3, 4] })}>{t("st.wordsChange")}</button>
          </div>
        )
      ) : mv ? (
        <div className="flex flex-col gap-3">
          <p className="small muted m-0">{t("st.moveLead")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field"><span className="flabel">{t("st.date")}</span><input type="date" className="input" value={mv.date} onChange={(e) => setMv({ ...mv, date: e.target.value })} /></label>
            <label className="field"><span className="flabel">{t("st.time")}</span><input type="time" className="input" step={300} value={mv.time} onChange={(e) => setMv({ ...mv, time: e.target.value })} /></label>
          </div>
          <div className="actions"><button className="btn secondary" onClick={() => setMv(null)}>{t("common.cancel")}</button><button className="btn primary" disabled={pending || !mv.date} onClick={() => run(() => moveSlot(o.slotId!, o.iso, { date: mv.date, startMin: toMin(mv.time) }, p.studentId))}>{t("st.move")}</button></div>
        </div>
      ) : (
        <>
          <div className="actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            {o.kind === "homework" && !p.teacher && p.hwLink && <Link className="btn primary" href={p.hwLink}><Icon name="clip" size="sm" />{t("st.openHw")}</Link>}
            {canMark && o.status !== "done" && <button className="btn primary" disabled={pending} onClick={() => run(() => markSlot(o.slotId!, o.iso, true, p.studentId))}><Icon name="check" size="sm" />{t("st.markDone")}</button>}
            {canMark && o.status === "done" && <button className="btn secondary" disabled={pending} onClick={() => run(() => markSlot(o.slotId!, o.iso, false, p.studentId))}>{t("st.unmark")}</button>}
            {o.status !== "done" && <button className="btn secondary" onClick={() => setMv({ date: days.find((d) => !d.past)?.iso ?? o.iso, time: hm(o.startMin) })}>{o.status === "unmarked" ? t("st.makeUp") : t("st.move")}</button>}
            <button className="btn plain" onClick={onEdit}><Icon name="pencil" size="sm" />{t("st.edit")}</button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {o.repeat && <button className="btn plain sm" disabled={pending} onClick={() => confirm(t("st.delDayQ")) && run(() => removeSlot(o.slotId!, "day", o.iso, p.studentId))}>{t("st.delDay")}</button>}
            <button className="btn plain sm text-bad" disabled={pending} onClick={() => confirm(o.repeat ? t("st.delAllQ") : t("st.delQ")) && run(() => removeSlot(o.slotId!, "all", o.iso, p.studentId))}>{o.repeat ? t("st.delAll") : t("st.del")}</button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Под расписанием: самостоятельная работа недели — план и сделано, норма по маршруту, что добавить из маршрута. */
export function StudyPlan({ p, onAdd }: { p: StudyProps; onAdd: (kind: StudyKind, title: string | null) => void }) {
  const { t } = useT();
  const h = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} ${t("st.h")}${m % 60 ? ` ${m % 60} ${t("dash.min")}` : ""}` : `${m} ${t("dash.min")}`);
  const goal = p.target ?? 0;
  const pct = (n: number) => (goal ? Math.min(100, Math.round((n / goal) * 100)) : 0);
  return (
    <section className="card stplan mt-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="m-0 grow">{p.teacher ? t("st.planT") : t("st.plan")}</h3>
        <span className="small muted">{t("st.planDone", { d: h(p.done), p: h(p.planned) })}</span>
      </div>
      {goal > 0 ? (
        <>
          <div className="stbar" aria-hidden="true"><i className="pl" style={{ width: `${pct(p.planned)}%` }} /><i className="dn" style={{ width: `${pct(p.done)}%` }} /></div>
          <p className="small m-0">{p.planned >= goal ? t("st.enough", { g: h(goal) }) : t("st.need", { g: h(goal), n: h(goal - p.planned) })}</p>
        </>
      ) : <p className="small muted m-0">{t("st.noRoute")}</p>}
      {p.recs.length > 0 && (
        <div className="strecs">
          <b className="small">{t("st.recs")}</b>
          {p.recs.map((r) => (
            <div key={r.kind} className="strec">
              <span className="stdot" style={{ background: KIND[r.kind].color }} />
              <span className="grow min-w-0"><b>{r.title ?? t(`st.k.${r.kind}` as DictKey)}</b><span className="small muted block">{r.title && r.why === r.title ? t(`st.k.${r.kind}` as DictKey) : r.why}</span></span>
              <button type="button" className="btn tinted sm" onClick={() => onAdd(r.kind, r.title)}><Icon name="plus" size="sm" />{t("st.addShort")}</button>
            </div>
          ))}
        </div>
      )}
      <div className="legend stlegend">{STUDY_KINDS.map((k) => <span key={k}><i style={{ background: KIND[k].color }} />{t(`st.k.${k}` as DictKey)}</span>)}</div>
    </section>
  );
}
