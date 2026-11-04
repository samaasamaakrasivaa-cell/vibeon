"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { LangSwitch } from "../LangSwitch";
import { LogoMark } from "../Logo";
import { TaskCard, type TaskData } from "../tasks/TaskView";
import { AnswerProvider, type Answers } from "../tasks/store";
import { Catalog } from "../builder/Builder";
import { TaskEditor } from "../builder/TaskEditor";
import { Board, type BObj } from "./Board";
import { useLive } from "./useLive";
import { AiCheckView, type AiCheck } from "../ai/AiCheckView";
import { askAi, checkAnswer } from "@/lib/ai/actions";
import { useT } from "@/lib/i18n/client";
import { PRESET, SAMPLE, TYPES, type Rubric, type TaskType } from "@/lib/tasks/catalog";
import { saveTask } from "@/lib/teacher/courses";
import type { LiveState } from "@/lib/live/access";

type CTask = TaskData & { section: "lesson" | "homework" | "words"; rubricId: string | null; hidden: boolean };
type Word = { id: string; word: string; translation: string | null; example: string | null; level: number };
type Msg = { id: string; text: string; by: string; at: string };
export type Review = { ok: boolean; comment: string | null; ai?: AiCheck };
export type { AiCheck };
export type ClassData = {
  id: string; templateId: string | null; role: "teacher" | "student"; me: { id: string; name: string };
  teacher: { id: string; name: string; lastName: string | null }; student: { id: string; userId: string | null; name: string; lastName: string | null; level: string | null; course: string | null } | null;
  title: string | null; crumbs: string | null; course: { title: string; cover: string | null } | null; rubrics: Rubric[]; tasks: CTask[];
  answers: Answers; statuses: Record<string, string>; reviews: Record<string, Review>; aiDrafts: Record<string, AiCheck>; live: LiveState;
  board: BObj[][]; homework: { extraTaskIds: string[]; wordTraining: string[]; teacherComment: string | null };
  lessonWords: { word: string; tr: string; ex: string }[]; words: Word[]; messages: Msg[];
  note: string | null; studentNote: string | null; callLink: string | null; when: string; durationMin: number; status: string; goal: string | null;
  templates: { id: string; label: string }[]; homeHref: string; initialTab?: "lesson" | "homework" | "words" | "board";
};

export function ClassRoom({ d }: { d: ClassData }) {
  const { t, lang } = useT();
  const router = useRouter();
  const teacher = d.role === "teacher";
  const [tab, setTab] = useState<"lesson" | "homework" | "words" | "board">(d.initialTab ?? "lesson");
  const [answers, setAnswers] = useState<Answers>(d.answers);
  const [live, setLive] = useState<LiveState>(d.live ?? {});
  const [hw, setHw] = useState(d.homework);
  const [board, setBoard] = useState<BObj[][]>(d.board.length ? d.board : [[]]);
  const [page, setPage] = useState(d.live?.page ?? 0);
  const [msgs, setMsgs] = useState<Msg[]>(d.messages);
  const [words, setWords] = useState<Word[]>(d.words);
  const [reviews, setReviews] = useState(d.reviews);
  const [online, setOnline] = useState<string[]>([]);
  const [panel, setPanel] = useState<"chat" | "dict" | "timer" | null>(null);
  const [unread, setUnread] = useState(0);
  const [finished, setFinished] = useState(false);
  const [rubric, setRubric] = useState<string | null>(d.live?.rubricId ?? d.rubrics[0]?.id ?? null);
  const [flash, setFlash] = useState<string | null>(null);
  const [notes, setNotes] = useState({ teacher: d.note ?? "", student: d.studentNote ?? "" });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const onEvent = useCallback((ev: string, x: Record<string, unknown>) => {
    if (ev === "answer") { if (x.by !== d.me.id) setAnswers((a) => ({ ...a, [x.taskId as string]: { ...(a[x.taskId as string] ?? {}), [x.key as string]: x.value } })); }
    else if (ev === "live") {
      setLive((l) => ({ ...l, ...x }));
      if (!teacher) {
        if ("rubricId" in x && x.rubricId) setRubric(x.rubricId as string);
        if ("tab" in x && x.tab) setTab(x.tab as typeof tab);
        if (x.spotlight) { const s = x.spotlight as { taskId: string }; setTab("lesson"); setFlash(s.taskId); setTimeout(() => document.getElementById(`task-${s.taskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150); setTimeout(() => setFlash(null), 4000); }
        if ("page" in x && typeof x.page === "number") setPage(x.page);
      }
    } else if (ev === "hw") setHw((h) => ({ ...h, ...x }));
    else if (ev === "board") {
      if (x.by === d.me.id) return;
      const obj = x.obj as BObj, pg = x.page as number;
      if (x.op === "laser") { window.dispatchEvent(new CustomEvent("vibeon-laser", { detail: { ...obj, by: x.by } })); return; }
      setBoard((b) => {
        const n = b.map((p) => [...p]);
        while (n.length <= pg) n.push([]);
        if (x.op === "add") n[pg].push(obj);
        if (x.op === "update") n[pg] = n[pg].map((o) => (o.id === obj.id ? { ...o, ...obj } : o));
        if (x.op === "del") n[pg] = n[pg].filter((o) => o.id !== obj.id);
        if (x.op === "clear") n[pg] = [];
        return n;
      });
    } else if (ev === "chat") { setMsgs((m) => (m.some((y) => y.id === x.id) ? m : [...m, x as unknown as Msg])); if (x.by !== d.me.id) setUnread((u) => u + 1); }
    else if (ev === "note") setNotes((n) => ({ ...n, [x.who as string]: x.text as string }));
    else if (ev === "review") setReviews((r) => ({ ...r, [x.taskId as string]: x.review as Review }));
    else if (ev === "word") { if (x.op === "add") setWords((w) => [...w, x.word as Word]); else setWords((w) => w.filter((y) => y.id !== x.id)); }
    else if (ev === "presence") setOnline(x.online as string[]);
    else if (ev === "reload") router.refresh();
    else if (ev === "finished" && !teacher) setFinished(true);
  }, [d.me.id, teacher, router]);
  const { connected, send } = useLive(d.id, onEvent);

  // ответы: сразу в интерфейс, на сервер — с небольшой задержкой (набор текста)
  const setAnswer = useCallback((taskId: string, key: string, value: unknown) => {
    setAnswers((a) => ({ ...a, [taskId]: { ...(a[taskId] ?? {}), [key]: value } }));
    const k = taskId + key;
    clearTimeout(pending.current[k]);
    pending.current[k] = setTimeout(() => send("answer", { taskId, key, value }), key === "val" || key === "text" || key === "cell" || key === "fix" ? 350 : 0);
  }, [send]);

  const patchLive = (p: LiveState) => { setLive((l) => ({ ...l, ...p })); send("live", { patch: p }); };
  const hidden = new Set(live.hidden ?? []);
  const lessonTasks = d.tasks.filter((x) => x.section === "lesson" && !x.hidden && (teacher || !hidden.has(x.id)));
  const ri = Math.max(0, d.rubrics.findIndex((r) => r.id === rubric));
  const cur = d.rubrics[ri];
  const inRubric = lessonTasks.filter((x) => x.rubricId === cur?.id || (!x.rubricId && ri === 0) || (x.rubricId && !d.rubrics.some((r) => r.id === x.rubricId) && ri === 0));
  const hwTasks = [...d.tasks.filter((x) => x.section === "homework" && !x.hidden), ...d.tasks.filter((x) => hw.extraTaskIds.includes(x.id))];
  const go = (id: string) => { setRubric(id); if (teacher) patchLive({ rubricId: id }); };
  const studentOnline = d.student?.userId ? online.includes(d.student.userId) : false;
  const teacherOnline = online.includes(d.teacher.id);
  const other = teacher ? studentOnline : teacherOnline;
  const timerLeft = live.timer ? Math.max(0, Math.round((live.timer.endsAt - now) / 1000)) : 0;
  const [catalog, setCatalog] = useState<{ index: number } | null>(null);
  const [editing, setEditing] = useState<{ task: CTask; index: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dlg, setDlg] = useState<"about" | "hwc" | "fb" | "finish" | "pick" | null>(null);
  const templateId = !!d.templateId;

  const taskActions = (task: CTask, inHw: boolean) => {
    if (!teacher) return <AskButton task={task} send={send} context={`${d.crumbs ?? ""} · ${cur?.title ?? ""}`} />;
    const isHidden = hidden.has(task.id);
    const isHw = hw.extraTaskIds.includes(task.id);
    return (
      <span className="bld-acts">
        {inHw && <span className={`pill ${d.statuses[task.id] === "NEEDS_REVIEW" && !reviews[task.id] ? "orange" : "grey"}`}>{statusLabel(d.statuses[task.id], !!reviews[task.id], t)}</span>}
        <button className={`iconbtn ${live.spotlight?.taskId === task.id ? "bd-on" : ""}`} title={t("cls.show")} aria-label={t("cls.show")} onClick={() => patchLive({ spotlight: { taskId: task.id, at: Date.now() }, rubricId: cur?.id ?? null, tab: "lesson" })}><Icon name="move" size="sm" /></button>
        {!inHw && <button className={`iconbtn ${isHw ? "bd-on" : ""}`} title={isHw ? t("cls.fromHw") : t("bld.toHw")} aria-label={t("bld.toHw")} onClick={() => { const on = !isHw; setHw((h) => ({ ...h, extraTaskIds: on ? [...h.extraTaskIds, task.id] : h.extraTaskIds.filter((x) => x !== task.id) })); send("hw", { taskId: task.id, on }); }}><Icon name="inbox" size="sm" /></button>}
        <button className={`iconbtn ${isHidden ? "bd-on" : ""}`} title={isHidden ? t("bld.show") : t("bld.hide")} aria-label={t("bld.hide")} onClick={() => patchLive({ hidden: isHidden ? [...hidden].filter((x) => x !== task.id) : [...hidden, task.id] })}><Icon name={isHidden ? "lock" : "lockI"} size="sm" /></button>
        <Link className="iconbtn" href={`/builder/${templateOf(d)}`} target="_blank" title={t("cls.editInBuilder")} aria-label={t("cls.editInBuilder")}>⋯</Link>
      </span>
    );
  };

  const renderTasks = (list: CTask[], inHw = false) => (
    <>
      {teacher && !inHw && <Plus onClick={() => setCatalog({ index: 0 })} />}
      {list.length === 0 && <div className="tk-empty"><Icon name="book" />{inHw ? t("cls.noHw") : t("bld.emptyStudent")}</div>}
      {list.map((task, i) => (
        <div key={task.id} id={`task-${task.id}`} className={`${flash === task.id ? "cls-flash" : ""} ${hidden.has(task.id) ? "opacity-55" : ""}`}>
          <TaskCard task={task} index={i} actions={taskActions(task, inHw)} />
          {inHw && teacher && (TYPES[task.type].teacherCheck || task.type === "transform" || task.type === "translate") && <ReviewBox lessonId={d.id} task={task} review={reviews[task.id]} draft={d.aiDrafts[task.id]} answered={!!answers[task.id]} send={send} />}
          {inHw && !teacher && reviews[task.id] && <div className={`alert mt-2 ${reviews[task.id].ok ? "ok" : ""}`}>{reviews[task.id].ok ? "✓ " : ""}{t("cls.teacherSays")}: {reviews[task.id].comment || (reviews[task.id].ok ? t("cls.reviewedOk") : "—")}</div>}
          {inHw && !teacher && reviews[task.id]?.ai && <div className="mt-2"><AiCheckView check={reviews[task.id].ai!} /></div>}
          {teacher && !inHw && <Plus onClick={() => setCatalog({ index: i + 1 })} />}
        </div>
      ))}
    </>
  );

  return (
    <AnswerProvider answers={answers} onSet={setAnswer} role={d.role}>
      <div className={`cls ${teacher ? "as-teacher" : "as-student"}`}>
        <header className="cls-top">
          <Link href={d.homeHref} className="cls-logo" aria-label="VibeOn"><LogoMark size={36} /><small>Vibe<span>On</span></small></Link>
          <div className="cls-crumb"><small>{d.crumbs ?? t("cls.lesson")}</small><b>{d.title ?? t("cls.noTemplate")}</b></div>
          <nav className="cls-tabs">
            {([["lesson", "book", t("bld.lesson")], ["homework", "inbox", t("nav.homework")], ["words", "cards", teacher ? t("bld.newWords") : t("cls.myWords")], ["board", "pencil", t("cls.board")]] as const).map(([k, ic, label]) => (
              <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
                <Icon name={ic} size="sm" />{label}{k === "homework" && hwTasks.length + hw.wordTraining.length > 0 && <span className="count">{hwTasks.length + hw.wordTraining.length}</span>}
              </button>
            ))}
          </nav>
          <div className="atr">
            {d.callLink && <a href={d.callLink} target="_blank" rel="noreferrer" className="btn sm cls-call cls-call-top" aria-label={t("cls.joinCall")}><Icon name="phone" size="sm" /></a>}
            {teacher && <button className="btn secondary sm" onClick={() => setDlg("about")}><Icon name="info" size="sm" />{t("cls.about")}</button>}
            <LangSwitch lang={lang} label={t("common.language")} />
            <span className={`dot`} title={connected ? t("cls.online") : t("cls.offline")} style={{ background: connected ? "var(--ok)" : "var(--warn)" }} />
            <Link href={d.homeHref} className="iconbtn" title={t("cls.exit")} aria-label={t("cls.exit")}><Icon name="logout" size="sm" /></Link>
          </div>
        </header>

        <div className="cls-grid">
          <nav className="cls-rail">
            <button aria-pressed={panel === "chat"} onClick={() => { setPanel(panel === "chat" ? null : "chat"); setUnread(0); }}><Icon name="msg" /><span>{t("nav.chat")}</span>{unread > 0 && <i className="count">{unread}</i>}</button>
            <button aria-pressed={panel === "dict"} onClick={() => setPanel(panel === "dict" ? null : "dict")}><Icon name="book" /><span>{t("cls.dict")}</span></button>
            {teacher && <button aria-pressed={panel === "timer"} onClick={() => setPanel(panel === "timer" ? null : "timer")}><Icon name="clock" /><span>{t("cls.timer")}</span></button>}
            {live.timer && timerLeft > 0 && <div className="cls-timer">{Math.floor(timerLeft / 60)}:{String(timerLeft % 60).padStart(2, "0")}</div>}
          </nav>

          {panel && (
            <aside className="cls-panel">
              <button className="iconbtn dlgx" onClick={() => setPanel(null)} aria-label="close"><Icon name="close" size="sm" /></button>
              {panel === "chat" && <Chat msgs={msgs} me={d.me.id} send={send} names={{ [d.teacher.id]: d.teacher.name, ...(d.student?.userId ? { [d.student.userId]: d.student.name } : {}) }} />}
              {panel === "dict" && <Dict send={send} />}
              {panel === "timer" && <Timer onStart={(m) => patchLive({ timer: m ? { endsAt: Date.now() + m * 60000 } : null })} running={timerLeft > 0} />}
            </aside>
          )}

          <main className="cls-main">
            {tab === "lesson" && (
              !templateId ? (
                <div className="tk-empty">
                  <Icon name="book" />{teacher ? t("cls.pickLesson") : t("cls.waitLesson")}
                  {teacher && <button className="btn primary sm mt-2" onClick={() => setDlg("pick")}>{t("cls.pick")}</button>}
                </div>
              ) : (
                <>
                  <div className="mb-4 flex items-center gap-3">
                    <span className="pill grey">{ri + 1}/{Math.max(1, d.rubrics.length)}</span>
                    <h1>{cur?.title ?? t("bld.lesson")}</h1>
                  </div>
                  {renderTasks(inRubric)}
                  <div className="bld-foot">
                    <button className="btn secondary" disabled={ri <= 0} aria-label={t("sch.prev")} onClick={() => go(d.rubrics[ri - 1].id)}><Icon name="chevl" size="sm" />{d.rubrics[ri - 1]?.title ?? ""}</button>
                    <span />
                    <button className="btn secondary" disabled={ri >= d.rubrics.length - 1} onClick={() => go(d.rubrics[ri + 1].id)}>{d.rubrics[ri + 1]?.title ?? ""}<Icon name="right" size="sm" /></button>
                  </div>
                </>
              )
            )}
            {tab === "homework" && (
              <Homework teacher={teacher} tasks={hwTasks} statuses={d.statuses} reviews={reviews} training={hw.wordTraining} comment={hw.teacherComment} render={renderTasks} />
            )}
            {tab === "words" && <Words teacher={teacher} lessonWords={d.lessonWords} words={words} training={hw.wordTraining} send={send} setHw={setHw} />}
            {tab === "board" && (
              <Board pages={board} setPages={setBoard} page={page} setPage={setPage} role={d.role} me={d.me.id} locked={!!live.lockBoard} follow={!!live.follow}
                send={(type, data) => send(type, data)} onLive={(p) => patchLive(p as LiveState)} />
            )}
          </main>

          <aside className="cls-side">
            {d.callLink ? (
              <a href={d.callLink} target="_blank" rel="noreferrer" className="btn w-full cls-call"><Icon name="phone" size="sm" />{t("cls.joinCall")}</a>
            ) : <span className="btn w-full cls-call off" title={t("cls.noCallHint")}><Icon name="phone" size="sm" />{t("cls.noCall")}</span>}
            <div className="mt-2 flex items-center justify-center gap-2 small muted">
              <span className="relative"><span className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{(teacher ? d.student?.name : d.teacher.name)?.[0] ?? "?"}</span><i className="dot" style={{ position: "absolute", right: -2, bottom: -2, background: other ? "var(--ok)" : "var(--grey)" }} /></span>
              {other ? (teacher ? t("cls.studentIn", { name: d.student?.name ?? "" }) : t("cls.teacherIn")) : (teacher ? t("cls.studentOut", { name: d.student?.name ?? t("cls.student") }) : t("cls.teacherOut"))}
            </div>
            <div className="bld-cover mt-3" style={d.course?.cover ? { background: `center / cover url(${d.course.cover})` } : undefined}>{!d.course?.cover && <><Icon name="book" size="lg" /><b>{d.course?.title ?? "VibeOn"}</b></>}</div>
            <h2 className="mt-3">{d.title ?? t("cls.lesson")}</h2>
            <div className="mt-3 flex flex-col gap-1">
              {d.rubrics.map((r, i) => (
                <button key={r.id} className={`bld-sec ${tab === "lesson" && r.id === cur?.id ? "on" : ""}`} onClick={() => { setTab("lesson"); go(r.id); }}>
                  <span className="grow">{r.title}</span>{teacher && live.rubricId === r.id && <i className="dot" style={{ background: "var(--accent)" }} title={t("cls.studentHere")} />}
                  <small>{lessonTasks.filter((x) => x.rubricId === r.id || (!x.rubricId && i === 0)).length}</small>
                </button>
              ))}
            </div>
            <NoteBox title={teacher ? t("cls.teacherNote") : t("cls.myNotes")} value={teacher ? notes.teacher : notes.student} onSave={(v) => send("note", { text: v })} />
            {!teacher && notes.teacher && <div className="alert mt-3" style={{ background: "var(--warn-bg)", color: "var(--warn-text)" }}><b className="block small">{t("cls.fromTeacher")}</b>{notes.teacher}</div>}
            {teacher && (
              <div className="mt-4 flex flex-col gap-2">
                <button className="btn secondary w-full" onClick={() => setDlg("hwc")}><Icon name="inbox" size="sm" />{t("cls.hwComment")}{hw.teacherComment ? " (1)" : ""}</button>
                <button className="btn secondary w-full" onClick={() => setDlg("fb")}><Icon name="msg" size="sm" />{t("cls.feedback")}</button>
                <button className="btn primary w-full" onClick={() => setDlg("finish")}><Icon name="check" size="sm" />{t("cls.finish")}</button>
              </div>
            )}
            {!teacher && tab !== "homework" && hw.teacherComment && <div className="alert mt-3" style={{ background: "var(--accent-bg)", color: "var(--accent-text)" }}><b className="block small">{t("cls.hwComment")}</b>{hw.teacherComment}</div>}
          </aside>
        </div>

        {catalog && <Catalog fav={[]} onClose={() => setCatalog(null)} onPick={(ty: TaskType) => { const idx = catalog.index; setCatalog(null); setEditing({ index: idx, task: { id: "new", type: ty, title: PRESET[ty]?.[0] ?? "", content: SAMPLE[ty] ?? "", options: {}, section: "lesson", rubricId: cur?.id ?? null, hidden: false } }); }} />}
        {editing && (
          <TaskEditor lessonId={templateOf(d)} initial={editing.task} pending={saving} error={null} onClose={() => setEditing(null)}
            onSave={async (task) => {
              setSaving(true);
              const index = d.tasks.filter((x) => x.section === "lesson" && x.rubricId === editing.task.rubricId).findIndex((x) => x.id === inRubric[editing.index]?.id);
              await saveTask(templateOf(d), null, { section: "lesson", rubricId: editing.task.rubricId, type: task.type, title: task.title, content: task.content, options: task.options }, index < 0 ? undefined : index);
              setSaving(false); setEditing(null); await send("reload"); router.refresh();
            }} />
        )}
        <ClassDialogs which={dlg} close={() => setDlg(null)} d={d} hwComment={hw.teacherComment} send={send} onFinished={() => router.push(d.homeHref)} />
        {finished && (
          <Dialog open onClose={() => setFinished(false)} title={t("cls.over")}>
            <p className="muted mt-0">{hwTasks.length + hw.wordTraining.length > 0 ? t("cls.overHw") : t("cls.overNoHw")}</p>
            <div className="actions"><button className="btn secondary" onClick={() => { setFinished(false); setTab("homework"); }}>{t("nav.homework")}</button><Link className="btn primary" href={d.homeHref}>{t("cls.toCabinet")}</Link></div>
          </Dialog>
        )}
      </div>
    </AnswerProvider>
  );
}

const templateOf = (d: ClassData) => d.templateId ?? "";

function statusLabel(s: string | undefined, reviewed: boolean, t: (k: never) => string) {
  if (reviewed) return t("cls.st.reviewed" as never);
  if (s === "NEEDS_REVIEW") return t("cls.st.needs" as never);
  if (s === "AUTO_CHECKED") return t("cls.st.auto" as never);
  if (s === "SUBMITTED") return t("cls.st.started" as never);
  return t("cls.st.none" as never);
}

function Plus({ onClick }: { onClick: () => void }) {
  return <div className="bplus"><button type="button" onClick={onClick} aria-label="+">+</button></div>;
}

function AskButton({ task, send, context }: { task: TaskData; send: (type: string, d: Record<string, unknown>) => Promise<{ ok: boolean }>; context: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [ai, setAi] = useState<{ id: string; answer: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const reset = () => { setAi(null); setSent(false); setErr(null); setText(""); };
  const ask = async () => {
    setBusy(true); setErr(null);
    const r = await askAi(text, `${context} · ${task.title}`, task.id).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setBusy(false);
    if (r.ok) setAi({ id: r.id, answer: r.answer }); else setErr(r.error);
  };
  const toTeacher = async () => { await send("question", { taskId: task.id, text, context: `${context} · ${task.title}`, qid: ai?.id }); setSent(true); };
  return (
    <>
      <button className="btn secondary sm" onClick={() => { setOpen(true); reset(); }}><Icon name="qmark" size="sm" />{t("cls.unclear")}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("cls.unclear")}>
        {sent ? <p className="alert ok">{t("cls.askSent")}</p> : ai ? (
          <>
            <div className="aianswer"><span className="tk-aiico"><Icon name="spark" size="sm" /></span><div><b className="small">{t("ai.says")}</b><p className="m-0 mt-1">{ai.answer}</p></div></div>
            <div className="actions">
              <button className="btn secondary" onClick={toTeacher}>{t("cls.askTeacher")}</button>
              <button className="btn primary" onClick={() => setOpen(false)}>{t("ai.clear")}</button>
            </div>
          </>
        ) : (
          <>
            <div className="field"><label htmlFor={`q-${task.id}`}>{t("cls.describe")}</label><textarea id={`q-${task.id}`} className="textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus /></div>
            <p className="hint">{t("cls.aiFirst")}</p>
            {err && <div className="alert">{err}</div>}
            <div className="actions">
              {err && <button className="btn secondary" disabled={!text.trim()} onClick={toTeacher}>{t("cls.askTeacher")}</button>}
              <button className="btn primary" disabled={!text.trim() || busy} onClick={ask}><Icon name="spark" size="sm" />{busy ? t("ai.thinking") : t("ai.ask")}</button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

function ReviewBox({ lessonId, task, review, draft, answered, send }: { lessonId: string; task: TaskData; review?: Review; draft?: AiCheck; answered: boolean; send: (type: string, d: Record<string, unknown>) => Promise<unknown> }) {
  const { t } = useT();
  const [c, setC] = useState(review?.comment ?? "");
  const [ai, setAi] = useState<AiCheck | null>(review?.ai ?? draft ?? null);
  const [useAi, setUseAi] = useState(!!review?.ai || !!draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await checkAnswer(lessonId, task.id).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setBusy(false);
    if (r.ok) { setAi(r.check); setUseAi(true); } else setErr(r.error);
  }, [lessonId, task.id, t]);
  // «Предпроверка ИИ» в опциях задания: черновик готовится сам, как только есть ответ
  const auto = useRef(false);
  useEffect(() => { if (task.options.aipre && answered && !ai && !review && !auto.current) { auto.current = true; void run(); } }, [task.options.aipre, answered, ai, review, run]);
  const payload = () => (useAi && ai ? { ai } : {});
  return (
    <div className="flex flex-col gap-2">
      {ai && useAi && <AiCheckView check={ai} edit onChange={setAi} />}
      {err && <div className="alert">{err}</div>}
      <div className="cls-review">
        <input className="input" value={c} onChange={(e) => setC(e.target.value)} placeholder={t("cls.reviewPh")} aria-label={t("cls.reviewPh")} />
        <button className="btn tinted sm" disabled={busy} onClick={run}><Icon name="spark" size="sm" />{busy ? t("ai.checking") : ai ? t("ai.recheck") : t("ai.check")}</button>
        {ai && <button className="btn plain sm" onClick={() => setUseAi(!useAi)}>{useAi ? t("ai.hide") : t("ai.showDraft")}</button>}
        <button className="btn secondary sm" onClick={() => send("review", { taskId: task.id, ok: false, comment: c, ...payload() })}>{t("cls.needsWork")}</button>
        <button className="btn primary sm" onClick={() => send("review", { taskId: task.id, ok: true, comment: c, ...payload() })}>✓ {t("cls.okShow")}</button>
        {review && <span className="small text-ok">✓ {t("cls.st.reviewed")}</span>}
      </div>
    </div>
  );
}

function Homework({ teacher, tasks, statuses, reviews, training, comment, render }: {
  teacher: boolean; tasks: (TaskData & { section: string })[]; statuses: Record<string, string>; reviews: Record<string, Review>; training: string[]; comment: string | null;
  render: (list: never[], inHw?: boolean) => React.ReactNode;
}) {
  const { t } = useT();
  const [f, setF] = useState<"all" | "auto" | "needs">("all");
  const auto = tasks.filter((x) => statuses[x.id] === "AUTO_CHECKED");
  const needs = tasks.filter((x) => statuses[x.id] === "NEEDS_REVIEW" && !reviews[x.id]);
  const list = f === "auto" ? auto : f === "needs" ? needs : tasks;
  return (
    <>
      <h1 className="mb-4">{t("nav.homework")}</h1>
      {teacher && (
        <div className="seg mb-5">
          <button aria-pressed={f === "all"} onClick={() => setF("all")}>{t("cls.all")} · {tasks.length}</button>
          <button aria-pressed={f === "auto"} onClick={() => setF("auto")}>{t("cls.auto")} · {auto.length}</button>
          <button aria-pressed={f === "needs"} onClick={() => setF("needs")}>{t("cls.needs")} {needs.length > 0 && <span className="dot ml-1" style={{ background: "var(--warn)" }} />} · {needs.length}</button>
        </div>
      )}
      {!teacher && comment && <div className="alert mb-4" style={{ background: "var(--accent-bg)", color: "var(--accent-text)" }}>{comment}</div>}
      {training.length > 0 && f === "all" && (
        <div className="grid-2 mb-4">
          {training.map((k) => (
            <div key={k} className="tk flex items-center gap-3">
              <span className="si statt" style={{ background: "var(--accent-bg)", padding: 10 }}><Icon name="cards" /></span>
              <div className="grow"><b className="block">{k === "new" ? t("cls.trainNew") : t("cls.trainAll")}</b><span className="small muted">{t("cls.trainSoon")}</span></div>
              <Link href="/student/words" className="btn primary sm">{t("cls.start")}</Link>
            </div>
          ))}
        </div>
      )}
      {render(list as never[], true)}
    </>
  );
}

function Words({ teacher, lessonWords, words, training, send, setHw }: {
  teacher: boolean; lessonWords: { word: string; tr: string; ex: string }[]; words: Word[]; training: string[];
  send: (type: string, d: Record<string, unknown>) => Promise<unknown>; setHw: (fn: (h: ClassData["homework"]) => ClassData["homework"]) => void;
}) {
  const { t } = useT();
  const [accent, setAccent] = useState<"en-GB" | "en-US">("en-GB");
  const [q, setQ] = useState("");
  const say = (w: string) => { const u = new SpeechSynthesisUtterance(w); u.lang = accent; u.rate = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); };
  const levels = [t("cls.lv0"), t("cls.lv1"), t("cls.lv2"), t("cls.lv3"), t("cls.lv4")];
  const byWord = new Map(words.map((w) => [w.word.toLowerCase(), w]));
  const all = [...lessonWords.map((w) => ({ key: w.word, word: w.word, tr: w.tr, ex: w.ex, saved: byWord.get(w.word.toLowerCase()) })), ...words.filter((w) => !lessonWords.some((l) => l.word.toLowerCase() === w.word.toLowerCase())).map((w) => ({ key: w.id, word: w.word, tr: w.translation ?? "", ex: w.example ?? "", saved: w }))];
  const toggle = (kind: "new" | "review") => { const on = !training.includes(kind); setHw((h) => ({ ...h, wordTraining: on ? [...h.wordTraining, kind] : h.wordTraining.filter((x) => x !== kind) })); send("training", { kind, on }); };
  const bold = (ex: string, w: string) => ex.split(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i")).map((p, i) => (p.toLowerCase() === w.toLowerCase() ? <b key={i}>{p}</b> : p));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="grow">{teacher ? t("bld.newWords") : t("cls.myWords")}</h1>
        <div className="seg"><button aria-pressed={accent === "en-GB"} onClick={() => setAccent("en-GB")}>British</button><button aria-pressed={accent === "en-US"} onClick={() => setAccent("en-US")}>American</button></div>
        {teacher && <button className={`btn sm ${training.includes("new") ? "primary" : "tinted"}`} onClick={() => toggle("new")}><Icon name="inbox" size="sm" />{t("cls.trainNew")}</button>}
        {teacher && <button className={`btn sm ${training.includes("review") ? "primary" : "tinted"}`} onClick={() => toggle("review")}><Icon name="inbox" size="sm" />{t("cls.trainAll")}</button>}
      </div>
      <p className="muted mt-0">{teacher ? t("cls.wordsLead") : t("cls.wordsLeadS")}</p>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); const [w, tr = "", ex = ""] = q.split(/\s+[—–-]\s+/); if (w.trim()) send("word", { op: "add", word: w.trim(), tr, ex }); setQ(""); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("cls.addWordPh")} aria-label={t("cls.addWordPh")} />
        <button className="btn primary" disabled={!q.trim()}>{t("cls.addWord")}</button>
      </form>
      {all.length === 0 && <p className="hint">{t("cls.noWords")}</p>}
      <div className="list" style={{ background: "transparent" }}>
        {all.map((w) => (
          <div key={w.key} className="row" style={{ alignItems: "flex-start" }}>
            <button className="iconbtn" style={{ background: "var(--fill)" }} onClick={() => say(w.word)} aria-label={t("tk.listen")}><Icon name="sound" size="sm" /></button>
            <div className="grow"><b className="block">{w.word}</b><span className="small muted">{w.tr}</span>{w.ex && <div className="small mt-1"><i>{bold(w.ex, w.word)}</i></div>}</div>
            <div className="text-right">
              <div className="flex justify-end gap-1">{[0, 1, 2, 3].map((i) => <i key={i} className="lvl" style={{ background: (w.saved?.level ?? 0) > i ? "var(--accent)" : "var(--fill)" }} />)}</div>
              <span className="small muted">{levels[w.saved?.level ?? 0]}</span>
            </div>
            {teacher && w.saved && <button className="iconbtn" aria-label={t("common.delete")} onClick={() => send("word", { op: "del", wid: w.saved!.id })}>✕</button>}
          </div>
        ))}
      </div>
    </>
  );
}

function Chat({ msgs, me, send, names }: { msgs: Msg[]; me: string; send: (type: string, d: Record<string, unknown>) => Promise<unknown>; names: Record<string, string> }) {
  const { t } = useT();
  const [v, setV] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-2">{t("nav.chat")}</h3>
      <div className="cls-chat">
        {msgs.length === 0 && <p className="hint">{t("cls.chatEmpty")}</p>}
        {msgs.map((m) => <div key={m.id} className={`bubble ${m.by === me ? "me" : ""}`}><small>{names[m.by] ?? ""}</small>{m.text}</div>)}
        <div ref={end} />
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) send("chat", { text: v }); setV(""); }}>
        <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder={t("cls.message")} aria-label={t("cls.message")} />
        <button className="btn primary sm" disabled={!v.trim()} aria-label={t("cls.send")}><Icon name="send" size="sm" /></button>
      </form>
    </div>
  );
}

function Dict({ send }: { send: (type: string, d: Record<string, unknown>) => Promise<unknown> }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [added, setAdded] = useState("");
  const w = q.trim();
  return (
    <div>
      <h3 className="mb-2">{t("cls.dict")}</h3>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("cls.dictPh")} aria-label={t("cls.dictPh")} />
      {w && (
        <div className="mt-3 flex flex-col gap-2">
          <a className="btn secondary sm" target="_blank" rel="noreferrer" href={`https://dictionary.cambridge.org/dictionary/english-russian/${encodeURIComponent(w)}`}>Cambridge ↗</a>
          <a className="btn secondary sm" target="_blank" rel="noreferrer" href={`https://www.multitran.com/m.exe?l1=1&l2=2&s=${encodeURIComponent(w)}`}>Multitran ↗</a>
          <button className="btn primary sm" onClick={() => { send("word", { op: "add", word: w }); setAdded(w); setQ(""); }}>{t("cls.toLessonWords")}</button>
        </div>
      )}
      {added && <p className="small text-ok mt-2">✓ {added}</p>}
      <p className="hint mt-3">{t("cls.dictSoon")}</p>
    </div>
  );
}

function Timer({ onStart, running }: { onStart: (min: number) => void; running: boolean }) {
  const { t } = useT();
  return (
    <div>
      <h3 className="mb-2">{t("cls.timer")}</h3>
      <div className="grid grid-cols-3 gap-2">{[1, 2, 3, 5, 10, 15].map((m) => <button key={m} className="btn secondary sm" onClick={() => onStart(m)}>{m} {t("dash.min")}</button>)}</div>
      {running && <button className="btn danger sm mt-3 w-full w-full" onClick={() => onStart(0)}>{t("cls.stopTimer")}</button>}
      <p className="hint mt-3">{t("cls.timerHint")}</p>
    </div>
  );
}

function NoteBox({ title, value, onSave }: { title: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <div className="bld-out mt-4">
      <div className="cardtitle">{title}</div>
      <textarea className="textarea" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} aria-label={title} />
    </div>
  );
}

function ClassDialogs({ which, close, d, hwComment, send, onFinished }: { which: string | null; close: () => void; d: ClassData; hwComment: string | null; send: (type: string, x?: Record<string, unknown>) => Promise<{ ok: boolean }>; onFinished: () => void }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { setText(which === "hwc" ? hwComment ?? "" : ""); setDone(false); }, [which, hwComment]);
  const s = d.student;
  const goal = useMemo(() => d.goal, [d.goal]);
  if (!which) return null;
  if (which === "about")
    return (
      <Dialog open onClose={close} title={t("cls.about")}>
        <dl className="kv">
          <dt>{t("cls.student")}</dt><dd>{s ? [s.name, s.lastName].filter(Boolean).join(" ") : "—"}</dd>
          <dt>{t("prof.course")}</dt><dd>{d.course?.title ?? s?.course ?? "—"}</dd>
          <dt>{t("cls.lesson")}</dt><dd>{d.title ?? "—"}</dd>
          <dt>{t("prof.level")}</dt><dd>{s?.level ?? "—"}{goal ? ` → ${goal}` : ""}</dd>
          <dt>{t("today.time")}</dt><dd>{d.when} · {d.durationMin} {t("dash.min")}</dd>
        </dl>
        <p className="hint">{t("cls.aiAbout")}</p>
        {s && <div className="actions"><Link className="btn secondary" href={`/teacher/students/${s.id}`} target="_blank">{t("sch.openProfile")}</Link></div>}
      </Dialog>
    );
  if (which === "pick")
    return (
      <Dialog open onClose={close} title={t("cls.pick")}>
        <div className="pick" style={{ maxHeight: 380 }}>
          {d.templates.map((x) => <button key={x.id} onClick={async () => { await send("template", { templateId: x.id }); close(); }}>{x.label}</button>)}
          {d.templates.length === 0 && <p className="hint p-2">{t("crs.empty")}</p>}
        </div>
      </Dialog>
    );
  if (which === "finish")
    return (
      <Dialog open onClose={close} title={t("cls.finishQ")}>
        <p className="muted mt-0">{t("cls.finishHint")}</p>
        <div className="actions"><button className="btn secondary" onClick={close}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await send("finish"); setBusy(false); close(); onFinished(); }}>{t("cls.finish")}</button></div>
      </Dialog>
    );
  const isHw = which === "hwc";
  return (
    <Dialog open onClose={close} title={isHw ? t("cls.hwComment") : t("cls.feedback")}>
      {done ? <p className="alert ok">✓ {isHw ? t("common.saved") : t("cls.fbSent")}</p> : (
        <>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={isHw ? t("cls.hwCommentPh") : t("cls.feedbackPh")} autoFocus aria-label={isHw ? t("cls.hwComment") : t("cls.feedback")} />
          <p className="hint">{isHw ? t("cls.hwCommentHint") : t("cls.feedbackHint")}</p>
          <div className="actions"><button className="btn secondary" onClick={close}>{t("common.cancel")}</button>
            <button className="btn primary" disabled={busy || (!isHw && !text.trim())} onClick={async () => { setBusy(true); await send(isHw ? "hwComment" : "feedback", { text }); setBusy(false); setDone(true); }}>{isHw ? t("common.save") : t("cls.send")}</button></div>
        </>
      )}
    </Dialog>
  );
}
