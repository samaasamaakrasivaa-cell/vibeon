"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { addDraftTasks, bookCreate, bookPlan, splitToTasks } from "@/lib/ai/actions";
import type { DraftTask } from "@/lib/ai/tasks";
import { TYPES } from "@/lib/tasks/catalog";
import { COURSE_CATEGORIES } from "@/lib/tasks/catalog";
import { countBySection, importPrompt, parseImport, wordCount, type ImpIssue, type ImpMeta, type ImpTask } from "@/lib/tasks/import-json";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";

/** Текст из файла (Word, PDF, PowerPoint, фото) — через /api/ai/extract. */
export async function extractFile(f: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", f);
  const r = await fetch("/api/ai/extract", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "fail");
  return j.text as string;
}

const ACCEPT = ".docx,.pptx,.pdf,.txt,.md,.json,image/png,image/jpeg,image/webp";

/** Кнопка «Скопировать инструкцию для Claude»: как подготовить готовый JSON урока по своим материалам. */
function PromptCopy() {
  const { t } = useT();
  const [ok, setOk] = useState(false);
  return (
    <div className="impjson">
      <span className="small grow">{t("ai.jsonLead")}</span>
      <button type="button" className="btn secondary sm" onClick={async () => { try { await navigator.clipboard.writeText(importPrompt()); setOk(true); setTimeout(() => setOk(false), 2500); } catch { /* буфер недоступен */ } }}>
        <Icon name="copy" size="sm" />{ok ? t("ai.promptCopied") : t("ai.promptCopy")}
      </button>
    </div>
  );
}

function DraftList({ tasks, picked, setPicked }: { tasks: DraftTask[]; picked: Set<number>; setPicked: (s: Set<number>) => void }) {
  const { lang } = useT();
  return (
    <div className="pick" style={{ maxHeight: 360 }}>
      {tasks.map((x, i) => (
        <label key={i} className="drafttask">
          <input type="checkbox" checked={picked.has(i)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(i); else n.delete(i); setPicked(n); }} />
          <span className="grow">
            <span className="pill grey">{lang === "en" ? TYPES[x.type].en : TYPES[x.type].ru}</span>{x.section === "homework" && <span className="pill orange ml-1">{lang === "en" ? "Homework" : "Домашка"}</span>}{x.teacherOnly && <span className="pill ml-1">{lang === "en" ? "Teacher only" : "Только учителю"}</span>}
            <b className="block mt-1">{x.title || "—"}</b>
            <span className="small muted whitespace-pre-line line-clamp-3">{x.content}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Сводка файла перед загрузкой: сколько заданий уйдёт в урок, домашку и новые слова, и что пропущено. */
function ImportSummary({ tasks, issues }: { tasks: ImpTask[]; issues: ImpIssue[] }) {
  const { t } = useT();
  const c = countBySection(tasks), w = wordCount(tasks.filter((x) => x.section === "words"));
  return (
    <div className="impsum">
      <span><b>{t("ai.impLesson")}</b> {c.lesson}</span><span><b>{t("ai.impHw")}</b> {c.homework}</span><span><b>{t("ai.impWords")}</b> {c.words}{w ? ` (${t("ai.impWordsN", { n: w })})` : ""}</span>
      {issues.length > 0 && (
        <details className="w-full"><summary className="small text-bad">{t("ai.impIssues", { n: issues.length })}</summary>
          <ul className="small mt-1 mb-0">{issues.map((x, i) => <li key={i}>{t("ai.impIssue", { n: x.n, title: x.title || "—", why: t(`ai.impWhy.${x.reason}` as "ai.impWhy.type") })}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/** «Импорт» в конструкторе: файл или вставленный текст → задания урока. */
export function ImportDialog({ lessonId, section, rubricId, onClose, onDone, hasTasks = false }: { lessonId: string; section: "lesson" | "homework" | "words"; rubricId: string | null; onClose: () => void; onDone: () => void; hasTasks?: boolean }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState<DraftTask[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fromJson, setFromJson] = useState(false);
  const [replace, setReplace] = useState(hasTasks); // в уроке уже есть задания — по умолчанию файл заменяет урок целиком (исправленная версия)
  const [meta, setMeta] = useState<ImpMeta | undefined>(); // блок «Для учителя», длительность, подзаголовок из файла
  const [issues, setIssues] = useState<ImpIssue[]>([]); // задания файла, которые пропущены (остальные загружаются)
  const [result, setResult] = useState<{ by: Record<string, number>; failed: { title: string; error: string }[] } | null>(null);
  const code = (e: unknown) => { const c = String((e as Error).message); return ["limit", "tariff", "off", "fail", "type", "size"].includes(c) ? t(`ai.err.${c}` as "ai.err.fail") : c; };
  const read = async (f?: File) => {
    if (!f) return;
    if (/\.json$/i.test(f.name)) { setText(await f.text()); return; } // готовый JSON читаем сами, без распознавания
    setBusy(t("ai.reading")); setErr(null);
    try { setText(await extractFile(f)); } catch (e) { setErr(code(e)); } finally { setBusy(null); }
  };
  const split = async () => {
    // готовый JSON (например, от Claude) — задания сразу, без ИИ-разбора
    const plan = parseImport(text);
    if (plan) { const all = plan.units.flatMap((u) => u.lessons.flatMap((l) => l.tasks)); setTasks(all); setPicked(new Set(all.map((_, i) => i))); setFromJson(true); setMeta(plan.units[0]?.lessons[0]?.meta); setIssues(plan.issues ?? []); return; }
    setBusy(t("ai.splitting")); setErr(null);
    const r = await splitToTasks(text).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setBusy(null);
    if (r.ok) { setTasks(r.tasks); setPicked(new Set(r.tasks.map((_, i) => i))); } else setErr(r.error);
  };
  const add = async () => {
    setBusy(t("common.saving")); setErr(null);
    if (replace && !confirm(t("ai.replaceSure"))) { setBusy(null); return; }
    const r = await addDraftTasks(lessonId, section, rubricId, tasks!.filter((_, i) => picked.has(i)), fromJson && replace, fromJson ? meta : undefined);
    setBusy(null);
    if (!r.ok) { setErr(r.error === "answers" ? t("ai.replaceAnswers") : r.error); return; }
    onDone();
    // итог по разделам; есть пропуски — показываем, иначе сразу закрываем
    const res = r as { by?: Record<string, number>; failed?: { title: string; error: string }[] };
    if (fromJson || res.failed?.length) setResult({ by: res.by ?? {}, failed: res.failed ?? [] }); else onClose();
  };
  return (
    <Dialog open onClose={onClose} title={t("bld.import")} wide>
      {result ? (
        <>
          <div className="impsum ok"><Icon name="check" size="sm" /><span>{t("ai.impDone", { l: result.by.lesson ?? 0, h: result.by.homework ?? 0, w: result.by.words ?? 0 })}</span></div>
          {result.failed.length > 0 && <ul className="small mt-2 mb-0">{result.failed.map((f, i) => <li key={i}>{f.error.startsWith("limit:") ? t("ai.impLimit", { n: f.error.slice(6) }) : `${f.title || "—"}: ${f.error}`}</li>)}</ul>}
          <div className="actions"><button className="btn primary" onClick={onClose}>{t("ai.impOk")}</button></div>
        </>
      ) : <>
      {!tasks ? (
        <>
          <p className="muted mt-0">{t("ai.importLead")}</p>
          <PromptCopy />
          <label className="upl"><Icon name="clip" />{busy === t("ai.reading") ? busy : t("ai.chooseFile")}<input type="file" hidden accept={ACCEPT} onChange={(e) => read(e.target.files?.[0])} /></label>
          <div className="field mt-3"><label htmlFor="imp-t" className="small muted">{t("ai.orPaste")}</label><textarea id="imp-t" className="textarea" style={{ minHeight: 200 }} value={text} onChange={(e) => setText(e.target.value)} /></div>
        </>
      ) : tasks.length ? <>
        {fromJson && <ImportSummary tasks={tasks.filter((_, i) => picked.has(i)) as ImpTask[]} issues={issues} />}
        {meta?.teacher && <p className="small m-0 mb-2"><Icon name="lock" size="sm" /> {t("ai.jsonTeacher")}</p>}
        <DraftList tasks={tasks} picked={picked} setPicked={setPicked} />
        {fromJson && hasTasks && (
          <div className="impmode mt-3" role="radiogroup" aria-label={t("ai.replace")}>
            <label><input type="radio" checked={replace} onChange={() => setReplace(true)} /><span><b>{t("ai.replace")}</b><span className="block small muted">{t("ai.replaceHint")}</span></span></label>
            <label><input type="radio" checked={!replace} onChange={() => setReplace(false)} /><span><b>{t("ai.appendAll")}</b><span className="block small muted">{t("ai.appendHint")}</span></span></label>
          </div>
        )}
      </> : <p className="hint">{t("ai.noTasks")}</p>}
      {err && <div className="alert mt-3">{err}</div>}
      <div className="actions">
        {tasks && <button className="btn secondary" onClick={() => setTasks(null)}>{t("common.back")}</button>}
        {!tasks
          ? <button className="btn primary" disabled={!text.trim() || !!busy} onClick={split}>{parseImport(text) ? <><Icon name="check" size="sm" />{t("ai.jsonUse")}</> : <><Icon name="spark" size="sm" />{busy ?? t("ai.split")}</>}</button>
          : <button className="btn primary" disabled={!picked.size || !!busy} onClick={add}>{busy ?? t("ai.addN", { n: picked.size })}</button>}
      </div>
      </>}
    </Dialog>
  );
}

type Plan = { units: { title: string; lessons: { title: string; tasks: DraftTask[] }[] }[] };
type BookFile = { name: string; role: string; text: string | null; err?: string };

/** «Из учебника»: Student’s Book, Workbook, Teacher’s Book → курс; проверка урок за уроком перед созданием. */
export function BookDialog({ courseId, onClose }: { courseId?: string; onClose: () => void }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [files, setFiles] = useState<BookFile[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set()); // снятые уроки «u-l»
  const [bookIssues, setBookIssues] = useState<ImpIssue[]>([]); // пропущенные задания готового JSON
  const [open, setOpen] = useState<string | null>("0-0");
  const [f, setF] = useState({ title: "", level: "", category: "general" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const roles = [["student", "Student’s Book"], ["workbook", "Workbook"], ["teacher", "Teacher’s Book"]] as const;

  const addFiles = async (picked: FileList | null) => {
    const list = picked ? [...picked] : []; // копия: поле выбора файла очищается сразу после выбора
    if (!list.length) return;
    // готовый JSON курса или уроков — план сразу, без ИИ
    const js = list.find((x) => /\.json$/i.test(x.name));
    if (js) {
      const p = parseImport(await js.text());
      if (!p) { setErr(t("ai.jsonBad")); return; }
      setF((x) => ({ ...x, title: x.title || p.title || js.name.replace(/\.json$/i, ""), level: x.level || p.level || "" }));
      setPlan({ units: p.units }); setBookIssues(p.issues ?? []); setOff(new Set()); return;
    }
    const fresh = list.map((x) => ({ name: x.name, role: /work ?book|wb/i.test(x.name) ? "workbook" : /teacher|tb\b/i.test(x.name) ? "teacher" : "student", text: null as string | null }));
    setFiles((a) => [...a, ...fresh]);
    const first = list[0].name;
    if (!f.title) setF((x) => ({ ...x, title: first.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80) }));
    setBusy(t("ai.reading"));
    for (const file of list) {
      try { const text = await extractFile(file); setFiles((a) => a.map((x) => (x.name === file.name && x.text === null ? { ...x, text } : x))); }
      catch (e) { const c = String((e as Error).message); setFiles((a) => a.map((x) => (x.name === file.name && x.text === null ? { ...x, text: "", err: ["limit", "tariff", "off", "fail", "type", "size"].includes(c) ? t(`ai.err.${c}` as "ai.err.fail") : c } : x))); }
    }
    setBusy(null);
  };
  const analyse = async () => {
    setBusy(t("ai.splitting")); setErr(null);
    const r = await bookPlan(files.filter((x) => x.text).map((x) => ({ role: x.role, name: x.name, text: x.text! }))).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setBusy(null);
    if (r.ok) { setPlan({ units: r.units }); setOff(new Set()); } else setErr(r.error);
  };
  const create = async () => {
    if (!plan) return;
    setBusy(t("common.saving")); setErr(null);
    const kept = { units: plan.units.map((u, ui) => ({ ...u, lessons: u.lessons.filter((_, li) => !off.has(`${ui}-${li}`)) })).filter((u) => u.lessons.length) };
    const r = await bookCreate(kept, courseId ? { courseId } : f);
    setBusy(null);
    if (r.ok) { onClose(); router.push(`/teacher/courses/${r.id}`); } else setErr(r.error);
  };
  const total = plan ? plan.units.reduce((a, u, ui) => a + u.lessons.filter((_, li) => !off.has(`${ui}-${li}`)).length, 0) : 0;

  return (
    <Dialog open onClose={onClose} title={t("crs.fromBook")} wide>
      {!plan ? (
        <>
          <p className="muted mt-0">{t("ai.bookLead")}</p>
          <PromptCopy />
          {files.map((x, i) => (
            <div key={i} className="bookfile">
              <Icon name="book" size="sm" /><span className="grow truncate">{x.name}{x.text === null ? ` · ${t("ai.reading")}` : x.err ? ` · ${x.err}` : ` · ${t("ai.chars", { n: x.text.length })}`}</span>
              <select className="select" style={{ width: 170 }} value={x.role} aria-label={t("ai.role")} onChange={(e) => setFiles((a) => a.map((y, j) => (j === i ? { ...y, role: e.target.value } : y)))}>{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button type="button" className="iconbtn" aria-label={t("common.delete")} onClick={() => setFiles((a) => a.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <label className="upl mt-2"><Icon name="plus" />{t("ai.addBookFiles")}<input type="file" hidden multiple accept={ACCEPT} onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} /></label>
          {!courseId && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="field sm:col-span-1"><label htmlFor="bk-t">{t("crs.title")}</label><input id="bk-t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
              <div className="field"><label htmlFor="bk-l">{t("prof.level")}</label><input id="bk-l" className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} placeholder="B1" /></div>
              <div className="field"><label htmlFor="bk-c">{t("crs.category")}</label><select id="bk-c" className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{COURSE_CATEGORIES.map((c) => <option key={c[0]} value={c[0]}>{lang === "en" ? c[1] : c[2]}</option>)}</select></div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted mt-0">{t("ai.bookCheck")}</p>
          {plan.units.some((u) => u.lessons.some((l) => l.tasks.some((x) => x.section && x.section !== "lesson"))) || bookIssues.length ? <ImportSummary tasks={plan.units.flatMap((u) => u.lessons.flatMap((l) => l.tasks)) as ImpTask[]} issues={bookIssues} /> : null}
          <div className="pick" style={{ maxHeight: 420 }}>
            {plan.units.map((u, ui) => (
              <div key={ui} className="mb-3">
                <div className="cardtitle">{u.title}</div>
                {u.lessons.map((l, li) => {
                  const k = `${ui}-${li}`;
                  return (
                    <div key={k} className="booklesson">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={!off.has(k)} aria-label={l.title} onChange={(e) => { const n = new Set(off); if (e.target.checked) n.delete(k); else n.add(k); setOff(n); }} />
                        <button type="button" className="grow text-left font-semibold" onClick={() => setOpen(open === k ? null : k)}>{l.title}</button>
                        <span className="small muted">{t("ai.nTasks", { n: l.tasks.length })}</span>
                      </div>
                      {open === k && (
                        <ul className="ainotes mt-2">
                          {l.tasks.map((x, i) => <li key={i}><span><span className="pill grey">{lang === "en" ? TYPES[x.type].en : TYPES[x.type].ru}</span> {x.title || x.content.slice(0, 80)}</span></li>)}
                          {!l.tasks.length && <li className="muted">—</li>}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {!plan.units.length && <p className="hint">{t("ai.noTasks")}</p>}
          </div>
        </>
      )}
      {err && <div className="alert mt-3">{err}</div>}
      <div className="actions">
        {plan ? <button className="btn secondary" onClick={() => setPlan(null)}>{t("common.back")}</button> : <button className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>}
        {!plan
          ? <button className="btn primary" disabled={!files.some((x) => x.text) || !!busy || (!courseId && !f.title.trim())} onClick={analyse}><Icon name="spark" size="sm" />{busy ?? t("ai.analyse")}</button>
          : <button className="btn primary" disabled={!total || !!busy} onClick={create}>{busy ?? (courseId ? t("ai.addLessons", { n: total }) : t("ai.createCourse", { n: total }))}</button>}
      </div>
    </Dialog>
  );
}
