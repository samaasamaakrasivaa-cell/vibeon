"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { COURSE_CATEGORIES } from "@/lib/tasks/catalog";
import {
  assignLesson, createLessonTemplate, createUnit, deleteCourse, deleteLessonTemplate, deleteUnit, mergeLessons,
  placeLessons, reorderUnits, updateCourse, updateLessonMeta, updateUnit,
} from "@/lib/teacher/courses";
import { COVER, COVER_INK } from "./CoursesBoard";
import { useRun } from "./useRun";

type Lesson = { id: string; title: string; subtitle: string | null; durationMin: number; tasks: number };
type Unit = { id: string; title: string; collapsed: boolean; lessons: Lesson[] };
export type CourseData = { id: string; title: string; level: string | null; category: string; cover: string | null; color: number; units: Unit[]; studentsOn: number };
export type AssignStudent = { id: string; name: string; next: string | null };

export async function upload(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "upload");
  return (await r.json()) as { url: string; name: string };
}

/** Поле, которое редактируется на месте и сохраняется при уходе с него. */
function Editable({ value, onSave, className = "", placeholder }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className={`editable ${className}`} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== value && onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} onClick={(e) => e.preventDefault()} />
  );
}

export function CourseView({ c, students }: { c: CourseData; students: AssignStudent[] }) {
  const { t, lang } = useT();
  const { pending, error, run } = useRun();
  const [units, setUnits] = useState(c.units);
  useEffect(() => setUnits(c.units), [c.units]);
  const [drag, setDrag] = useState<{ kind: "unit" | "lesson"; id: string } | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [assign, setAssign] = useState<Lesson | null>(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: c.title, level: c.level ?? "", category: c.category });
  const fileRef = useRef<HTMLInputElement>(null);
  const lessonsTotal = units.reduce((a, u) => a + u.lessons.length, 0);
  const minutes = units.reduce((a, u) => a + u.lessons.reduce((b, l) => b + l.durationMin, 0), 0);
  let n = 0;

  const dropUnit = (beforeId: string) => {
    if (drag?.kind !== "unit" || drag.id === beforeId) return;
    const ids = units.map((u) => u.id);
    const from = ids.indexOf(drag.id), to = ids.indexOf(beforeId);
    const next = [...units]; const [x] = next.splice(from, 1); next.splice(to, 0, x);
    setUnits(next); setDrag(null);
    run(() => reorderUnits(c.id, next.map((u) => u.id)));
  };
  const dropLesson = (unitId: string, beforeId: string | null) => {
    if (drag?.kind !== "lesson") return;
    const lesson = units.flatMap((u) => u.lessons).find((l) => l.id === drag.id)!;
    const next = units.map((u) => ({ ...u, lessons: u.lessons.filter((l) => l.id !== drag.id) }));
    const target = next.find((u) => u.id === unitId)!;
    const at = beforeId ? target.lessons.findIndex((l) => l.id === beforeId) : target.lessons.length;
    target.lessons.splice(at < 0 ? target.lessons.length : at, 0, lesson);
    setUnits(next); setDrag(null);
    run(() => placeLessons(unitId, target.lessons.map((l) => l.id)));
  };

  return (
    <>
      <div className="chead">
        <div className="ccover" style={{ background: c.cover ? `center / cover url(${c.cover})` : COVER[c.color % 6], color: COVER_INK[c.color % 6] }}>
          {!c.cover && <Icon name="book" />}
          <button type="button" className="coverbtn" aria-label={t("crs.cover")} title={t("crs.cover")} onClick={() => fileRef.current?.click()}><Icon name="image" size="sm" /></button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const r = await upload(file); run(() => updateCourse(c.id, { cover: r.url })); } }} />
        </div>
        <div className="flex-1">
          <div className="small font-bold tracking-wide text-accent">{t("crs.course").toUpperCase()}</div>
          <h1 className="mt-1">{c.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {c.level && <span className="metapill"><Icon name="chart" size="sm" />{c.level}</span>}
            <span className="metapill"><Icon name="book" size="sm" />{t("crs.units", { n: units.length })}</span>
            <span className="metapill"><Icon name="cal" size="sm" />{t("crs.lessons", { n: lessonsTotal })}</span>
            <span className="metapill"><Icon name="clock" size="sm" />≈ {Math.round(minutes / 60)} {t("crs.h")}</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn primary" disabled={pending} onClick={() => run(() => createUnit(c.id, ""))}><Icon name="plus" size="sm" />{t("crs.newUnit")}</button>
            <button className="btn secondary sm" onClick={() => setEdit(true)}><Icon name="pencil" size="sm" />{t("crs.edit")}</button>
            <span className="small muted inline-flex items-center gap-1"><Icon name="users" size="sm" />{t("crs.studentsOn", { n: c.studentsOn })}</span>
          </div>
        </div>
      </div>

      <div className="alert ok my-4 flex items-center gap-2" style={{ background: "var(--accent-bg)", color: "var(--accent-text)" }}>
        <Icon name="info" size="sm" />{t("crs.dragHint")}
      </div>
      {checked.length >= 2 && (
        <div className="mb-4 flex items-center gap-3">
          <button className="btn primary sm" disabled={pending} onClick={() => run(() => mergeLessons(checked), () => setChecked([]))}>{t("crs.merge", { n: checked.length })}</button>
          <button className="btn plain sm" onClick={() => setChecked([])}>{t("common.cancel")}</button>
        </div>
      )}
      {error && <div className="alert mb-4">{error}</div>}

      {units.map((u, ui) => (
        <section key={u.id} className={`unit ${drag?.id === u.id ? "opacity-50" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={() => (drag?.kind === "unit" ? dropUnit(u.id) : dropLesson(u.id, null))}>
          <div className="unithead" draggable onDragStart={() => setDrag({ kind: "unit", id: u.id })}>
            <span className="draghandle">⋮⋮</span>
            <button className="iconbtn" aria-label="collapse" onClick={() => run(() => updateUnit(u.id, { collapsed: !u.collapsed }))} style={{ transform: u.collapsed ? "rotate(-90deg)" : "none" }}>▾</button>
            <span className="unitbadge"><small>UNIT</small><b>{ui + 1}</b></span>
            <div className="min-w-0 flex-1"><Editable className="text-[19px] font-bold" value={u.title} onSave={(v) => run(() => updateUnit(u.id, { title: v }))} /></div>
            <span className="small muted whitespace-nowrap">{t("crs.lessons", { n: u.lessons.length })}</span>
            <button className="btn secondary sm" disabled={pending} onClick={() => run(() => createLessonTemplate(u.id, ""))}><Icon name="plus" size="sm" />{t("crs.lesson")}</button>
            <button className="iconbtn" title={t("crs.delUnit")} aria-label={t("crs.delUnit")} onClick={() => confirm(t("crs.delUnitQ", { name: u.title })) && run(() => deleteUnit(u.id))}>✕</button>
          </div>
          {!u.collapsed && (
            <div className="py-2">
              {u.lessons.length === 0 && <p className="hint px-5 py-2 m-0">{t("crs.noLessons")}</p>}
              {u.lessons.map((l) => {
                n++;
                return (
                  <div key={l.id} className={`lrow ${drag?.id === l.id ? "dragging" : ""}`} draggable onDragStart={(e) => { e.stopPropagation(); setDrag({ kind: "lesson", id: l.id }); }}
                    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); dropLesson(u.id, l.id); }}>
                    <span className="draghandle">⋮⋮</span>
                    <input type="checkbox" className="check" checked={checked.includes(l.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, l.id] : checked.filter((x) => x !== l.id))} aria-label={t("crs.select")} />
                    <span className="ln">{n}</span>
                    <div className="grow">
                      <Editable className="font-semibold" value={l.title} onSave={(v) => run(() => updateLessonMeta(l.id, { title: v }))} />
                      <Editable className="small" value={l.subtitle ?? ""} placeholder={t("crs.subtitlePh")} onSave={(v) => run(() => updateLessonMeta(l.id, { subtitle: v }))} />
                    </div>
                    <span className="dur small inline-flex items-center gap-1 text-text3 whitespace-nowrap"><Icon name="clock" size="sm" />{l.durationMin} {t("dash.min")} · {t("crs.tasks", { n: l.tasks })}</span>
                    <div className="lacts flex gap-2">
                      <Link href={`/builder/${l.id}`} className="btn secondary sm"><Icon name="pencil" size="sm" />{t("crs.builder")}</Link>
                      <button className="btn primary sm" onClick={() => setAssign(l)}>{t("crs.assign")}</button>
                      <button className="iconbtn" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => confirm(t("crs.delLessonQ", { name: l.title })) && run(() => deleteLessonTemplate(l.id))}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}

      <div className="mt-8 border-t border-sep pt-4">
        <button className="btn plain" style={{ color: "var(--bad)" }} onClick={() => confirm(t("crs.delCourseQ", { name: c.title })) && run(() => deleteCourse(c.id))}>{t("crs.delCourse")}</button>
      </div>

      <Dialog open={!!assign} onClose={() => setAssign(null)} title={`${t("crs.assign")}: ${assign?.title ?? ""}`}>
        <p className="muted mt-0">{t("crs.assignLead")}</p>
        {students.length === 0 ? <p className="hint">{t("inviteT.none")}</p> : (
          <div className="pick" style={{ maxHeight: 320 }}>
            {students.map((s) => (
              <button key={s.id} type="button" disabled={!s.next || pending} onClick={() => assign && run(() => assignLesson(assign.id, s.id), () => setAssign(null))}>
                <span className="grow text-left"><b className="block">{s.name}</b><span className="small muted">{s.next ? t("crs.nextAt", { d: s.next }) : t("prof.noNext")}</span></span>
              </button>
            ))}
          </div>
        )}
        {error && <div className="alert mt-3">{error}</div>}
      </Dialog>

      <Dialog open={edit} onClose={() => setEdit(false)} title={t("crs.edit")}>
        <div className="flex flex-col gap-3">
          <div className="field"><label htmlFor="ce-t">{t("crs.title")}</label><input id="ce-t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="field"><label htmlFor="ce-l">{t("prof.level")}</label><input id="ce-l" className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></div>
            <div className="field"><label htmlFor="ce-c">{t("crs.category")}</label>
              <select id="ce-c" className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {COURSE_CATEGORIES.map((x) => <option key={x[0]} value={x[0]}>{lang === "en" ? x[1] : x[2]}</option>)}
              </select>
            </div>
          </div>
          {c.cover && <button className="btn plain sm self-start" onClick={() => run(() => updateCourse(c.id, { cover: null }))}>{t("crs.removeCover")}</button>}
        </div>
        <div className="actions">
          <button className="btn secondary" onClick={() => setEdit(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending} onClick={() => run(() => updateCourse(c.id, f), () => setEdit(false))}>{t("common.save")}</button>
        </div>
      </Dialog>
    </>
  );
}
