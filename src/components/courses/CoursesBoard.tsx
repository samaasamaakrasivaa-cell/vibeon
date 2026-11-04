"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { COURSE_CATEGORIES } from "@/lib/tasks/catalog";
import { createCourse, reorderCategories, reorderCourses } from "@/lib/teacher/courses";
import { moveItem, useRun } from "./useRun";

export type CourseCard = { id: string; title: string; level: string | null; category: string; cover: string | null; color: number; units: number; lessons: number };
export const COVER = ["#FFF4E0", "#EEEDFF", "#E5F0FF", "#E8F8EC", "#FDECEB", "#E0F7F8"];
export const COVER_INK = ["#8A5300", "#5856D6", "#0057B8", "#1E7B34", "#C4161C", "#0B7480"];

export function CoursesBoard({ courses: initial, order }: { courses: CourseCard[]; order: string[] }) {
  const { t, lang } = useT();
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [courses, setCourses] = useState(initial);
  const [cats, setCats] = useState(order);
  useEffect(() => { setCourses(initial); }, [initial]);
  useEffect(() => { setCats(order); }, [order]);
  const [drag, setDrag] = useState<{ kind: "course" | "cat"; id: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", level: "", category: "general" });
  const catName = (k: string) => { const c = COURSE_CATEGORIES.find((x) => x[0] === k); return c ? (lang === "en" ? c[1] : c[2]) : k; };
  const used = cats.filter((k) => courses.some((c) => c.category === k));

  const dropCourse = (cat: string, beforeId: string | null) => {
    if (!drag || drag.kind !== "course") return;
    const moving = courses.find((c) => c.id === drag.id)!;
    const rest = courses.filter((c) => c.id !== drag.id);
    const inCat = rest.filter((c) => c.category === cat);
    const at = beforeId ? inCat.findIndex((c) => c.id === beforeId) : inCat.length;
    inCat.splice(at < 0 ? inCat.length : at, 0, { ...moving, category: cat });
    setCourses([...rest.filter((c) => c.category !== cat), ...inCat]);
    setDrag(null);
    run(() => reorderCourses(cat, inCat.map((c) => c.id)));
  };
  const dropCat = (beforeKey: string) => {
    if (!drag || drag.kind !== "cat" || drag.id === beforeKey) return;
    const next = moveItem(cats, cats.indexOf(drag.id), cats.indexOf(beforeKey));
    setCats(next); setDrag(null);
    run(() => reorderCategories(next));
  };

  return (
    <>
      <button type="button" className="newcourse" onClick={() => setOpen(true)}>
        <span className="ico"><Icon name="plus" /></span>
        <span className="grow"><b>{t("crs.new")}</b><small>{t("crs.newSub")}</small></span>
        <Icon name="right" />
      </button>

      {used.length === 0 && <div className="card mt-6"><p className="hint m-0">{t("crs.empty")}</p></div>}
      {used.map((k) => {
        const list = courses.filter((c) => c.category === k);
        return (
          <section key={k} className="mt-7" onDragOver={(e) => e.preventDefault()} onDrop={() => (drag?.kind === "cat" ? dropCat(k) : dropCourse(k, null))}>
            <div className="mb-3 flex items-center gap-2" draggable onDragStart={() => setDrag({ kind: "cat", id: k })}>
              <span className="draghandle" title={t("crs.drag")}>⋮⋮</span>
              <h2>{catName(k)}</h2>
              <span className="text-text3">{list.length}</span>
            </div>
            <div className="grid-3">
              {list.map((c) => (
                <Link key={c.id} href={`/teacher/courses/${c.id}`} className={`ccard ${drag?.id === c.id ? "dragging" : ""}`}
                  draggable onDragStart={(e) => { e.stopPropagation(); setDrag({ kind: "course", id: c.id }); }}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); dropCourse(k, c.id); }}>
                  <span className="ccover" style={{ background: c.cover ? `center / cover url(${c.cover})` : COVER[c.color % 6], color: COVER_INK[c.color % 6] }}>{!c.cover && <Icon name="book" />}</span>
                  <span className="grow">
                    <b>{c.title}</b>
                    <span>{c.level ?? "—"}</span>
                    <span>{t("crs.counts", { u: c.units, l: c.lessons })}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <Dialog open={open} onClose={() => setOpen(false)} title={t("crs.new")}>
        <div className="flex flex-col gap-3">
          <div className="field"><label htmlFor="c-t">{t("crs.title")}</label><input id="c-t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Speaking B2" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="field"><label htmlFor="c-l">{t("prof.level")}</label><input id="c-l" className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} placeholder="B1–B2" /></div>
            <div className="field"><label htmlFor="c-c">{t("crs.category")}</label>
              <select id="c-c" className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {COURSE_CATEGORIES.map((c) => <option key={c[0]} value={c[0]}>{lang === "en" ? c[1] : c[2]}</option>)}
              </select>
            </div>
          </div>
          <div className="statt" style={{ alignItems: "flex-start" }}>
            <span className="si" style={{ background: "linear-gradient(135deg,#A55CF5,#3D8BFF)" }}><Icon name="spark" /></span>
            <div><b className="text-[15px]">{t("crs.fromBook")}</b><span>{t("common.soon", { n: 8 })}</span></div>
          </div>
          {error && <div className="alert">{error}</div>}
        </div>
        <div className="actions">
          <button className="btn secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending} onClick={() => run(() => createCourse(f), (r) => router.push(`/teacher/courses/${r.id}`))}>{t("crs.create")}</button>
        </div>
      </Dialog>
    </>
  );
}
