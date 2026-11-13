"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { randomId } from "./rid";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { LangSwitch } from "../LangSwitch";
import { Brand, LogoMark } from "../Logo";
import { TaskCard, type TaskData } from "../tasks/TaskView";
import { useRun } from "../courses/useRun";
import { TaskEditor } from "./TaskEditor";
import { Catalog } from "./Catalog";
import { BookDialog, ImportDialog } from "../ai/BookImport";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { GROUPS, numbered, PRESET, RTIPS, RUBRICS, SAMPLE, TYPES, rubricKey, type Rubric, type TaskType } from "@/lib/tasks/catalog";
import { thumbSvg } from "@/lib/tasks/thumbs";
import { assignLesson, deleteTask, placeTasks, resetShare, saveTask, setFavourites, setRubrics, setShare, toggleStudentSees, updateLessonMeta, updateTeacherInfo } from "@/lib/teacher/courses";
import { TeacherInfo } from "../lesson/TeacherInfo";
import { hasInfo, type TInfo } from "@/lib/tasks/teacher-info";

type Part = "lesson" | "homework" | "words";
export type BTask = TaskData & { section: Part; rubricId: string | null; hidden: boolean };
export type BuilderData = {
  id: string; title: string; subtitle: string; durationMin: number; outcomes: string[]; rubrics: Rubric[]; teacherInfo: TInfo;
  course: { id: string; title: string; cover: string | null }; unitNo: number; lessonNo: number;
  tasks: BTask[]; fav: string[]; share: { on: boolean; token: string | null }; appUrl: string;
  students: { id: string; name: string; next: string | null }[];
};

export function Builder({ d }: { d: BuilderData }) {
  const { t, lang } = useT();
  const { pending, error, run, setError } = useRun();
  const [part, setPart] = useState<Part>("lesson");
  const [rubrics, setRub] = useState(d.rubrics);
  useEffect(() => { setRub(d.rubrics); }, [d.rubrics]);
  const [active, setActive] = useState(d.rubrics[0]?.id ?? null);
  // «Переместить в другой раздел»: этапы урока, домашка, новые слова
  const [moving, setMoving] = useState<string | null>(null);
  const inDest = (x: BTask, sec: Part, rid: string | null) => x.section === sec && (sec !== "lesson" || x.rubricId === rid || (!x.rubricId && rid === d.rubrics[0]?.id));
  const moveTo = (task: BTask, sec: Part, rid: string | null) => {
    setMoving(null);
    go(() => placeTasks(d.id, sec, rid, [...d.tasks.filter((x) => x.id !== task.id && inDest(x, sec, rid)).map((x) => x.id), task.id]));
  };
  useEffect(() => { if (!rubrics.some((r) => r.id === active)) setActive(rubrics[0]?.id ?? null); }, [rubrics, active]);
  const [studentView, setStudentView] = useState(false);
  const [catalog, setCatalog] = useState<{ index: number } | null>(null);
  const [editing, setEditing] = useState<{ task: BTask; index?: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [imp, setImp] = useState<"file" | "book" | null>(null);
  const router = useRouter();
  const [saved, setSaved] = useState(true);
  useEffect(() => { if (!pending) setSaved(true); }, [pending, d]);

  const list = d.tasks.filter((x) => x.section === part && (part !== "lesson" || x.rubricId === active || (!x.rubricId && active === rubrics[0]?.id)));
  const visible = studentView ? list.filter((x) => !x.hidden && !x.options?.teacherOnly) : list; // «вид ученика» — без скрытых и без заметок для учителя
  const count = (p: Part) => d.tasks.filter((x) => x.section === p).length;
  const ri = rubrics.findIndex((r) => r.id === active);
  const cur = rubrics[ri];
  const key = cur ? rubricKey(cur.title) : null;
  const L = (x: [string, string]) => (lang === "en" ? x[0] : x[1]);
  const go = (fn: () => Promise<Awaited<ReturnType<typeof saveTask>>>, after?: () => void) => { setSaved(false); run(fn, after); };

  const saveRubrics = (next: Rubric[]) => { setRub(next); go(() => setRubrics(d.id, next)); };
  const newTask = (type: TaskType, index: number) =>
    setEditing({ index, task: { id: "new", type, title: PRESET[type]?.[0] ?? "", content: SAMPLE[type] ?? "", options: type === "drag" ? { mode: "drag" } : type === "note" ? { teacherOnly: true } : {}, /* заметка — по умолчанию только учителю */ section: part, rubricId: part === "lesson" ? active : null, hidden: false } });
  const move = (i: number, dir: -1 | 1) => {
    const ids = list.map((x) => x.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    go(() => placeTasks(d.id, part, part === "lesson" ? active : null, ids));
  };
  const plus = (index: number) => !studentView && (
    <div className="bplus"><button type="button" onClick={() => setCatalog({ index })} aria-label={t("bld.addTask")} title={t("bld.addTask")}>+</button></div>
  );
  const title = part === "lesson" ? (cur?.title ?? "") : part === "homework" ? t("nav.homework") : t("bld.newWords");

  return (
    <div className="bld">
      <header className="apptop flexbar">
        <div className="atl">
          <Link href={`/teacher/courses/${d.course.id}`} className="atl" aria-label="VibeOn"><LogoMark /><Brand /></Link>
          <span className="hdiv" /><span className="hsub">{t("bld.name")}</span>
        </div>
        <div className="bld-title">
          <small>{d.course.title} · Unit {d.unitNo} · Lesson {d.lessonNo}</small>
          <input className="editable text-center font-bold" defaultValue={d.title} key={d.title} onBlur={(e) => e.target.value.trim() !== d.title && go(() => updateLessonMeta(d.id, { title: e.target.value }))} aria-label={t("crs.title")} />
        </div>
        <div className="atr">
          {/* импорт виден всегда; на узком экране — только значок */}
          <button className="btn plain sm" title={t("bld.import")} aria-label={t("bld.import")} onClick={() => setImp("file")}><Icon name="down" size="sm" /><span className="hide-md">{t("bld.import")}</span></button>
          <button className="btn plain sm" title={t("bld.coursebook")} aria-label={t("bld.coursebook")} onClick={() => setImp("book")}><Icon name="book" size="sm" /><span className="hide-md">{t("bld.coursebook")}</span></button>
          <span className="small hide-md" style={{ color: saved ? "var(--ok)" : "var(--text3)" }}>{saved ? `✓ ${t("common.saved")}` : t("common.saving")}</span>
          <label className="flex items-center gap-2 small"><Icon name="user" size="sm" /><span className="hide-md">{t("bld.studentView")}</span><span className="switch"><input type="checkbox" checked={studentView} onChange={(e) => setStudentView(e.target.checked)} /><span /></span></label>
          <LangSwitch lang={lang} label={t("common.language")} />
          <button className="btn plain sm" onClick={() => setShareOpen(true)}><Icon name="link" size="sm" /><span className="hide-md">{t("bld.share")}</span></button>
          <button className="btn primary sm" onClick={() => setStartOpen(true)}><Icon name="flagI" size="sm" />{t("bld.start")}</button>
        </div>
      </header>

      <div className="bld-grid">
        <nav className="bld-rail" aria-label={t("bld.parts")}>
          {([["lesson", "book", t("bld.lesson")], ["homework", "inbox", t("nav.homework")], ["words", "cards", t("bld.newWords")]] as const).map(([p, ic, label]) => (
            <button key={p} type="button" aria-current={part === p ? "page" : undefined} onClick={() => setPart(p)}>
              <Icon name={ic} /><span>{label}</span><small>{count(p)}</small>
            </button>
          ))}
        </nav>

        <main className="bld-main">
          <div className="mb-4 flex items-center gap-2">
            {part === "lesson" && cur && !studentView ? (
              <input key={cur.id + cur.title} className="editable h1" defaultValue={cur.title} onBlur={(e) => e.target.value.trim() && e.target.value !== cur.title && saveRubrics(rubrics.map((r) => (r.id === cur.id ? { ...r, title: e.target.value.trim() } : r)))} aria-label={t("bld.rubric")} />
            ) : <h1>{title}</h1>}
            {part === "lesson" && rubrics.length > 1 && !studentView && (
              <button className="iconbtn" title={t("bld.delRubric")} aria-label={t("bld.delRubric")} onClick={() => confirm(t("bld.delRubricQ", { name: cur?.title ?? "" })) && saveRubrics(rubrics.filter((r) => r.id !== active))}><Icon name="close" size="sm" /></button>
            )}
          </div>
          {part === "words" && !studentView && <p className="hint mt-0">{t("bld.wordsHint")}</p>}
          {part === "homework" && !studentView && <p className="hint mt-0">{t("bld.hwHint")}</p>}

          {plus(0)}
          {visible.length === 0 && (
            <div className="tk-empty" style={{ cursor: "pointer" }} onClick={() => !studentView && setCatalog({ index: 0 })}>
              <Icon name="plus" />{studentView ? t("bld.emptyStudent") : t("bld.emptySection")}
            </div>
          )}
          {visible.map((task, i) => (
            <div key={task.id}>
              <div className={task.hidden || task.options?.teacherOnly ? "tk-teacheronly" : ""}>
                <TaskCard
                  task={task}
                  index={visible.filter((x, j) => j <= i && numbered(x)).length - 1}
                  actions={!studentView && (
                    <span className="bld-acts">
                      {task.hidden && <span className="pill grey">{t("bld.hidden")}</span>}
                      {task.options?.teacherOnly && <span className="pill violet">{t("bld.notSeen")}</span>}
                      <button className="iconbtn" title={t("bld.editTask")} aria-label={t("bld.editTask")} onClick={() => setEditing({ task })}><Icon name="pencil" size="sm" /></button>
                      {/* глазик: открыт — ученик видит, закрыт — только учитель */}
                      {(() => { const sees = !task.hidden && !task.options?.teacherOnly; return <button className={`iconbtn ${sees ? "" : "text-violet"}`} title={sees ? t("bld.eyeOn") : t("bld.eyeOff")} aria-label={sees ? t("bld.eyeOn") : t("bld.eyeOff")} aria-pressed={!sees} onClick={() => go(() => toggleStudentSees(task.id))}><Icon name={sees ? "eye" : "eyeoff"} size="sm" /></button>; })()}
                      <button className="iconbtn" disabled={i === 0} aria-label="up" onClick={() => move(i, -1)}>↑</button>
                      <button className="iconbtn" disabled={i === visible.length - 1} aria-label="down" onClick={() => move(i, 1)}>↓</button>
                      <span className="relative">
                        <button className="iconbtn" title={t("bld.moveTo")} aria-label={t("bld.moveTo")} aria-expanded={moving === task.id} onClick={() => setMoving(moving === task.id ? null : task.id)}><Icon name="shift" size="sm" /></button>
                        {moving === task.id && (
                          <div className="bld-movemenu" role="menu">
                            <div className="small muted px-2 pb-1">{t("bld.moveTo")}</div>
                            {rubrics.map((r) => !inDest(task, "lesson", r.id) && <button key={r.id} type="button" role="menuitem" onClick={() => moveTo(task, "lesson", r.id)}><Icon name="book" size="sm" />{r.title}</button>)}
                            {task.section !== "homework" && <button type="button" role="menuitem" onClick={() => moveTo(task, "homework", null)}><Icon name="home" size="sm" />{t("nav.homework")}</button>}
                            {task.section !== "words" && <button type="button" role="menuitem" onClick={() => moveTo(task, "words", null)}><Icon name="cards" size="sm" />{t("bld.newWords")}</button>}
                          </div>
                        )}
                      </span>
                      <button className="iconbtn" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => confirm(t("bld.delTaskQ")) && go(() => deleteTask(task.id))}><Icon name="close" size="sm" /></button>
                    </span>
                  )}
                />
              </div>
              {plus(i + 1)}
            </div>
          ))}

          {part === "lesson" && rubrics.length > 0 && (
            <div className="bld-foot">
              <button className="btn secondary" disabled={ri <= 0} onClick={() => setActive(rubrics[ri - 1]?.id)}><Icon name="chevl" size="sm" />{rubrics[ri - 1]?.title ?? ""}</button>
              <div className="flex items-center gap-2">
                <select className="select" value={active ?? ""} onChange={(e) => setActive(e.target.value)} aria-label={t("bld.rubric")}>
                  {rubrics.map((r, i) => <option key={r.id} value={r.id}>{i + 1}. {r.title}</option>)}
                </select>
                {!studentView && <button className="btn tinted" aria-label={t("bld.addRubric")} title={t("bld.addRubric")} onClick={() => { const r = { id: randomId(), title: t("bld.newRubric") }; saveRubrics([...rubrics, r]); setActive(r.id); }}>+</button>}
              </div>
              <button className="btn secondary" disabled={ri >= rubrics.length - 1} onClick={() => setActive(rubrics[ri + 1]?.id)}>{rubrics[ri + 1]?.title ?? ""}<Icon name="right" size="sm" /></button>
            </div>
          )}
        </main>

        <aside className="bld-side">
          <div className="bld-cover" style={d.course.cover ? { background: `center / cover url(${d.course.cover})` } : undefined}>{!d.course.cover && <><Icon name="book" size="lg" /><b>{d.course.title}</b></>}</div>
          <h2 className="mt-3">{d.title}</h2>
          <input className="editable muted mt-1" defaultValue={d.subtitle} key={d.subtitle} placeholder={t("crs.subtitlePh")} onBlur={(e) => e.target.value !== d.subtitle && go(() => updateLessonMeta(d.id, { subtitle: e.target.value }))} aria-label={t("crs.subtitlePh")} />
          {/* сведения об уроке, цели и ход урока — сразу под названием, ученику не показываются */}
          {!studentView && <TeacherInfo info={d.teacherInfo} open={hasInfo(d.teacherInfo)} onSave={(v) => go(() => updateTeacherInfo(d.id, v))} />}

          <div className="mt-5 mb-2 flex items-center justify-between"><span className="cardtitle m-0">{t("bld.sections")}</span></div>
          <div className="flex flex-col gap-1">
            {rubrics.map((r, i) => (
              <button key={r.id} type="button" className={`bld-sec ${part === "lesson" && r.id === active ? "on" : ""}`} onClick={() => { setPart("lesson"); setActive(r.id); }}
                draggable={!studentView} onDragStart={(e) => e.dataTransfer.setData("text/rubric", r.id)} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { const from = rubrics.findIndex((x) => x.id === e.dataTransfer.getData("text/rubric")); if (from >= 0 && from !== i) { const n = [...rubrics]; const [x] = n.splice(from, 1); n.splice(i, 0, x); saveRubrics(n); } }}>
                <span className="ln">{i + 1}</span><span className="grow">{r.title}</span><small>{d.tasks.filter((x) => x.section === "lesson" && (x.rubricId === r.id || (!x.rubricId && i === 0))).length}</small>
              </button>
            ))}
          </div>

          {!studentView && (
            <>
              <div className="cardtitle mt-5">{t("bld.stages")}</div>
              <div className="flex flex-wrap gap-1.5">
                {RUBRICS.filter((x) => !rubrics.some((r) => r.title.toLowerCase() === x.toLowerCase())).map((x) => (
                  <button key={x} type="button" className="pchip add" onClick={() => { const r = { id: randomId(), title: x }; saveRubrics([...rubrics, r]); setPart("lesson"); setActive(r.id); }}>+ {x}</button>
                ))}
              </div>
              {key && part === "lesson" && (
                <div className="aitip mt-4">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-violet"><Icon name="spark" size="sm" />{t("bld.tipsFor", { name: cur?.title ?? "" })}</div>
                  {RTIPS[key].tips.map((x, i) => <p key={i} className="small m-0 mb-1">• {L(x)}</p>)}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {RTIPS[key].tasks.map((ty) => <button key={ty} type="button" className="pchip" onClick={() => newTask(ty, list.length)}>+ {lang === "en" ? TYPES[ty].en : TYPES[ty].ru}</button>)}
                  </div>
                </div>
              )}
            </>
          )}
          <Outcomes d={d} onSave={(v) => go(() => updateLessonMeta(d.id, { outcomes: v }))} readOnly={studentView} />
        </aside>
      </div>

      {catalog && <Catalog fav={d.fav} onImport={() => { setCatalog(null); setImp("file"); }} onClose={() => setCatalog(null)} onPick={(ty) => { const idx = catalog.index; setCatalog(null); newTask(ty, idx); }} />}
      {editing && (
        <TaskEditor
          lessonId={d.id}
          initial={editing.task}
          pending={pending}
          error={error}
          onClose={() => { setEditing(null); setError(null); }}
          onSave={(task) => go(() => saveTask(d.id, editing.task.id === "new" ? null : editing.task.id, { section: editing.task.section, rubricId: editing.task.rubricId, type: task.type, title: task.title, content: task.content, options: task.options }, editing.index), () => setEditing(null))}
        />
      )}
      {imp === "file" && <ImportDialog hasTasks={d.tasks.length > 0} lessonId={d.id} section={part} rubricId={part === "lesson" ? active : null} onClose={() => setImp(null)} onDone={() => setTimeout(() => router.refresh(), 0)} />}
      {imp === "book" && <BookDialog courseId={d.course.id} onClose={() => setImp(null)} />}
      {shareOpen && <ShareDialog d={d} onClose={() => setShareOpen(false)} />}
      {startOpen && (
        <Dialog open onClose={() => setStartOpen(false)} title={t("bld.start")}>
          <p className="muted mt-0">{t("crs.assignLead")}</p>
          <div className="pick" style={{ maxHeight: 300 }}>
            {d.students.map((s) => (
              <button key={s.id} type="button" disabled={!s.next || pending} onClick={() => run(() => assignLesson(d.id, s.id), () => setStartOpen(false))}>
                <span className="grow text-left"><b className="block">{s.name}</b><span className="small muted">{s.next ? t("crs.nextAt", { d: s.next }) : t("prof.noNext")}</span></span>
              </button>
            ))}
            {d.students.length === 0 && <p className="hint p-2">{t("inviteT.none")}</p>}
          </div>
          <p className="hint mb-0">{t("bld.openClassSoon")}</p>
          {error && <div className="alert mt-3">{error}</div>}
        </Dialog>
      )}
    </div>
  );
}

function Outcomes({ d, onSave, readOnly }: { d: BuilderData; onSave: (v: string[]) => void; readOnly: boolean }) {
  const { t } = useT();
  const [v, setV] = useState(d.outcomes.join("\n"));
  useEffect(() => { setV(d.outcomes.join("\n")); }, [d.outcomes]);
  return (
    <div className="bld-out mt-5">
      <div className="cardtitle">{t("bld.outcomes")}</div>
      {readOnly ? <ul className="m-0 pl-5">{d.outcomes.map((x, i) => <li key={i}>{x}</li>)}</ul> : (
        <textarea className="textarea" value={v} placeholder={t("bld.outcomesPh")} onChange={(e) => setV(e.target.value)} onBlur={() => v !== d.outcomes.join("\n") && onSave(v.split("\n"))} aria-label={t("bld.outcomes")} />
      )}
    </div>
  );
}

function ShareDialog({ d, onClose }: { d: BuilderData; onClose: () => void }) {
  const { t } = useT();
  const { pending, run } = useRun();
  const [on, setOn] = useState(d.share.on);
  const [token, setToken] = useState(d.share.token);
  const [copied, setCopied] = useState(false);
  const link = token ? `${d.appUrl}/share/${token}` : "";
  return (
    <Dialog open onClose={onClose} title={t("bld.share")}>
      <label className="setting"><span><b className="block">{t("bld.shareLink")}</b><span className="small muted">{t("bld.shareHint")}</span></span>
        <span className="switch"><input type="checkbox" checked={on} disabled={pending} onChange={(e) => { const v = e.target.checked; setOn(v); run(() => setShare(d.id, v), (r) => setToken(r.token ?? token)); }} /><span /></span>
      </label>
      {on && token && (
        <div className="mt-3 flex flex-col gap-2">
          <code className="break-all rounded-xl bg-surface2 p-3 text-[13px]">{link}</code>
          <div className="flex flex-wrap gap-2">
            <button className="btn tinted sm" onClick={async () => { try { await navigator.clipboard.writeText(link); } catch { window.prompt("", link); } setCopied(true); }}><Icon name={copied ? "check" : "link"} size="sm" />{copied ? t("inviteT.copied") : t("inviteT.copy")}</button>
            <a className="btn secondary sm" href={link} target="_blank" rel="noreferrer">{t("bld.openLink")}</a>
            <button className="btn plain sm" disabled={pending} onClick={() => run(() => resetShare(d.id), (r) => { setToken(r.token ?? null); setCopied(false); })}>{t("bld.newLink")}</button>
          </div>
        </div>
      )}
      <div className="mt-5 border-t border-sep pt-4">
        <b className="block">{t("bld.pdf")}</b>
        <span className="small muted">{t("bld.pdfHint")}</span>
        <div className="mt-2 flex gap-2">
          <a className="btn secondary sm" href={`/builder/${d.id}/print`} target="_blank" rel="noreferrer"><Icon name="dl" size="sm" />{t("bld.pdfStudent")}</a>
          <a className="btn secondary sm" href={`/builder/${d.id}/print?keys=1`} target="_blank" rel="noreferrer"><Icon name="dl" size="sm" />{t("bld.pdfKeys")}</a>
        </div>
      </div>
    </Dialog>
  );
}
