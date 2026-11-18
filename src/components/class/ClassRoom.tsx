"use client";
import Link from "next/link";
import { TeacherInfo } from "../lesson/TeacherInfo";
import type { TInfo } from "@/lib/tasks/teacher-info";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { LangSwitch } from "../LangSwitch";
import { LogoMark } from "../Logo";
import { KeyCtx, MarkCtx, markMap, TaskCard, type MarkLayer, type TaskData } from "../tasks/TaskView";
import { isFinal, progressOf, summary, type Step } from "@/lib/tasks/progress";
import { AnswerProvider, type Answers } from "../tasks/store";
import { Catalog } from "../builder/Catalog";
import { TaskEditor } from "../builder/TaskEditor";
import { Board, type BObj } from "./Board";
import { useLive } from "./useLive";
import { AiCheckView, type AiCheck } from "../ai/AiCheckView";
import { askAi, checkAnswer } from "@/lib/ai/actions";
import { setCallLink } from "@/lib/teacher/actions";
import { useT } from "@/lib/i18n/client";
import { numbered, PRESET, RUBRICS, SAMPLE, TYPES, type Rubric, type TaskType } from "@/lib/tasks/catalog";
import { saveTask, setRubrics } from "@/lib/teacher/courses";
import type { LiveState } from "@/lib/live/access";
import { LessonCheer } from "../awards/LessonCheer";
import type { CatalogItem } from "@/lib/awards/catalog";
import { CelebrateAwards, type NewAward } from "../awards/StudentAwards";

type CTask = TaskData & { section: "lesson" | "homework" | "words"; rubricId: string | null; hidden: boolean };
type Word = { id: string; word: string; translation: string | null; example: string | null; level: number };
type Msg = { id: string; text: string; by: string; at: string; replyTo?: string | null; edited?: boolean; deleted?: boolean };
export type Review = { ok: boolean; comment: string | null; ai?: AiCheck };
export type { AiCheck };
export type ClassData = {
  id: string; templateId: string | null; role: "teacher" | "student"; me: { id: string; name: string }; preview?: boolean;
  teacher: { id: string; name: string; lastName: string | null }; student: { id: string; userId: string | null; name: string; lastName: string | null; level: string | null; course: string | null; gender?: string | null } | null;
  title: string | null; crumbs: string | null; course: { title: string; cover: string | null } | null; rubrics: Rubric[]; tasks: CTask[]; teacherInfo?: TInfo;
  answers: Answers; statuses: Record<string, string>; reviews: Record<string, Review>; aiDrafts: Record<string, AiCheck>; live: LiveState;
  board: BObj[][]; homework: { extraTaskIds: string[]; wordTraining: string[]; teacherComment: string | null; taskOrder?: string[]; removedTaskIds?: string[] };
  lessonWords: { word: string; tr: string; ex: string }[]; words: Word[]; messages: Msg[];
  note: string | null; studentNote: string | null; callLink: string | null; callOwn?: boolean; when: string; durationMin: number; status: string; goal: string | null;
  templates: { id: string; label: string }[]; homeHref: string;
  picker?: { courses: { id: string; title: string; cover: string | null; units: { id: string; title: string; lessons: { id: string; title: string; sub: string | null; cover: string | null }[] }[] }[]; used: string[] } | null; initialTab?: "lesson" | "homework" | "words" | "board"; addHw?: boolean;
  /** Групповое занятие: у каждого ученика свой урок (instanceId), класс общий. Учитель переключается между учениками. */
  group?: { title: string; members: { sid: string; instanceId: string; userId: string | null; name: string; gender?: string | null }[] };
  chatNames?: Record<string, string>; // чат группового урока: userId → имя
  cheers?: CatalogItem[]; // «Подарить приятность»: каталог приятностей (с правками владельца) — только учителю
  byStudent?: Record<string, { answers: Answers; statuses: Record<string, string>; reviews: Record<string, Review>; aiDrafts: Record<string, AiCheck>; words: Word[]; note?: string }>;
};

export function ClassRoom({ d }: { d: ClassData }) {
  const { t, lang } = useT();
  const router = useRouter();
  const teacher = d.role === "teacher";
  const [tab, setTab] = useState<"lesson" | "homework" | "words" | "board">(d.initialTab ?? "lesson");
  const [addHwTip, setAddHwTip] = useState(!!d.addHw); // пришли из «Домашки» по «+»: подсказать, как добавить задания
  // ответы, проверки и слова — по ученикам (в группе учитель смотрит выбранного ученика)
  const gTeacher = teacher && !!d.group;
  const own = d.student?.id ?? "_";
  // открыли урок конкретного ученика (например, из «Домашки») — сразу его ответы
  const [viewSid, setViewSid] = useState<string>(gTeacher ? (d.group!.members.find((m) => m.instanceId === d.id) ?? d.group!.members[0])?.sid ?? "_" : own);
  const viewRef = useRef(viewSid); viewRef.current = viewSid;
  const [ansBy, setAnsBy] = useState<Record<string, Answers>>(() => (gTeacher ? Object.fromEntries(Object.entries(d.byStudent ?? {}).map(([k, v]) => [k, v.answers])) : { [own]: d.answers }));
  const answers = ansBy[viewSid] ?? {};
  const statusesAll = d.statuses;
  const statuses = gTeacher ? d.byStudent?.[viewSid]?.statuses ?? {} : d.statuses;
  const aiDrafts = gTeacher ? d.byStudent?.[viewSid]?.aiDrafts ?? {} : d.aiDrafts;
  const viewMember = d.group?.members.find((m) => m.sid === viewSid);
  const [live, setLive] = useState<LiveState>(d.live ?? {});
  const [hw, setHw] = useState(d.homework);
  const [board, setBoard] = useState<BObj[][]>(d.board.length ? d.board : [[]]);
  const [page, setPage] = useState(d.live?.page ?? 0);
  const [msgs, setMsgs] = useState<Msg[]>(d.messages);
  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  const [wordsBy, setWordsBy] = useState<Record<string, Word[]>>(() => (gTeacher ? Object.fromEntries(Object.entries(d.byStudent ?? {}).map(([k, v]) => [k, v.words])) : { [own]: d.words }));
  const words = wordsBy[viewSid] ?? [];
  const [revBy, setRevBy] = useState<Record<string, Record<string, Review>>>(() => (gTeacher ? Object.fromEntries(Object.entries(d.byStudent ?? {}).map(([k, v]) => [k, v.reviews])) : { [own]: d.reviews }));
  const reviews = revBy[viewSid] ?? {};
  const [online, setOnline] = useState<string[]>([]);
  const [panel, setPanel] = useState<"chat" | "dict" | "timer" | null>(null);
  const [unread, setUnread] = useState(0);
  const [finished, setFinished] = useState(false);
  const [cheers, setCheers] = useState<NewAward[]>([]); // «приятности» от учителя — праздничное окно прямо на уроке
  const [rubric, setRubric] = useState<string | null>(d.live?.rubricId ?? d.rubrics[0]?.id ?? null);
  const [flash, setFlash] = useState<string | null>(null);
  // подсказки правильных ответов у учителя (запоминаем выбор на этом устройстве)
  const [showKeys, setShowKeys] = useState(true);
  useEffect(() => { try { if (localStorage.getItem("vibeon.keys") === "0") setShowKeys(false); } catch { /* приватный режим */ } }, []);
  const [notes, setNotes] = useState({ teacher: d.note ?? "" });
  // общие заметки урока: у каждого ученика свои; пишут и он, и учитель
  const [snotes, setSnotes] = useState<Record<string, string>>(() => (d.group && teacher ? Object.fromEntries(Object.entries(d.byStudent ?? {}).map(([k, v]) => [k, v.note ?? ""])) : { [d.student?.id ?? "_"]: d.studentNote ?? "" }));
  const [noteSid, setNoteSid] = useState<string>(d.group && teacher ? d.group.members[0]?.sid ?? "_" : d.student?.id ?? "_");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // таймер, чат, словарь: клик в любом месте урока вне панели — панель закрывается
  useEffect(() => {
    if (!panel) return;
    const h = (e: MouseEvent) => { const el = e.target as HTMLElement; if (!el.closest(".cls-panel") && !el.closest(".cls-rail") && !el.closest("dialog") && !el.closest("[data-keep-panel]")) setPanel(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [panel]);

  // «Показать ученику» (указка): ученика переносит туда, где задание, — вкладка, секция, прокрутка; задание мигает зелёным 3 раза
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pointBy, setPointBy] = useState<{ name: string; at: number } | null>(null); // ученик указал на задание
  const [noteFlash, setNoteFlash] = useState(false); // учитель показал на заметки урока
  const spotlight = useCallback((taskId: string, where?: string) => {
    const task = d.tasks.find((x) => x.id === taskId);
    if (!task) return;
    // учитель указал из домашки — во «Домашку»; иначе туда, где задание лежит
    const inHw = where === "homework" || task.section === "homework";
    setTab(inHw ? "homework" : "lesson");
    if (!inHw) {
      const rid = task.rubricId && d.rubrics.some((r) => r.id === task.rubricId) ? task.rubricId : d.rubrics[0]?.id ?? null;
      if (rid) setRubric(rid);
    }
    setFlash(null); // повторная указка на то же задание — мигание начинается заново
    if (flashTimer.current) clearTimeout(flashTimer.current);
    requestAnimationFrame(() => setFlash(taskId));
    // ждём, пока откроется нужная секция, и прокручиваем к заданию
    let tries = 0;
    const scroll = () => { const el = document.getElementById(`task-${taskId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); else if (tries++ < 10) setTimeout(scroll, 100); };
    setTimeout(scroll, 120);
    flashTimer.current = setTimeout(() => setFlash(null), 3600);
  }, [d.tasks, d.rubrics]);

  const onEvent = useCallback((ev: string, x: Record<string, unknown>) => {
    // чей ответ: sid; ученик группы получает только свои
    const sid = (x.sid as string | undefined) ?? own;
    const mineOnly = !teacher && x.sid !== undefined && x.sid !== own;
    if (ev === "answer") { if (x.by !== d.me.id && !mineOnly) setAnsBy((all) => { const a = all[sid] ?? {}; return { ...all, [sid]: { ...a, [x.taskId as string]: { ...(a[x.taskId as string] ?? {}), [x.key as string]: x.value } } }; }); }
    else if (ev === "live") {
      setLive((l) => ({ ...l, ...x }));
      if (!teacher) {
        if ("rubricId" in x && x.rubricId) setRubric(x.rubricId as string);
        if ("tab" in x && x.tab) setTab(x.tab as typeof tab);
        if (x.spotlight) spotlight((x.spotlight as { taskId: string }).taskId, x.tab as string | undefined);
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
    } else if (ev === "notepoint") {
      // заметки урока: учитель указал всем или именно мне
      if (!teacher && (!x.sid || x.sid === d.student?.id)) {
        setNoteFlash(false); requestAnimationFrame(() => setNoteFlash(true));
        document.getElementById("cls-snote")?.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => setNoteFlash(false), 3600);
      }
    } else if (ev === "point") {
      if (teacher && x.by !== d.me.id) { spotlight(x.taskId as string, x.where as string | undefined); setPointBy({ name: String(x.name ?? ""), at: Date.now() }); setTimeout(() => setPointBy(null), 5000); }
    } else if (ev === "chat") {
      // правка и удаление приходят тем же событием — заменяем сообщение по id
      const isNew = !msgsRef.current.some((y) => y.id === x.id);
      setMsgs((m) => (m.some((y) => y.id === x.id) ? m.map((y) => (y.id === x.id ? (x as unknown as Msg) : y)) : [...m, x as unknown as Msg]));
      if (isNew && x.by !== d.me.id) setUnread((u) => u + 1);
    }
    else if (ev === "note") { if (x.who === "teacher") setNotes((n) => ({ ...n, teacher: x.text as string })); }
    else if (ev === "snote") { if (x.by !== d.me.id && (teacher || x.sid === own)) setSnotes((n) => ({ ...n, [x.sid as string]: x.text as string })); }
    else if (ev === "reset") {
      // учитель сбросил ответы задания: одному ученику (sid) или всем
      const taskId = x.taskId as string, who = x.sid as string | null;
      if (!teacher && who && who !== own) return;
      setAnsBy((all) => Object.fromEntries(Object.entries(all).map(([k, a]) => [k, who && k !== who ? a : Object.fromEntries(Object.entries(a).filter(([tk]) => tk !== taskId))])));
      setRevBy((all) => Object.fromEntries(Object.entries(all).map(([k, r]) => [k, who && k !== who ? r : Object.fromEntries(Object.entries(r).filter(([tk]) => tk !== taskId))])));
      setResetTick((r) => ({ ...r, [taskId]: (r[taskId] ?? 0) + 1 }));
    }
    else if (ev === "review") { if (!mineOnly) setRevBy((all) => ({ ...all, [sid]: { ...(all[sid] ?? {}), [x.taskId as string]: x.review as Review } })); }
    else if (ev === "word") { if (!mineOnly) setWordsBy((all) => { const w = all[sid] ?? []; return { ...all, [sid]: x.op === "add" ? (w.some((y) => y.id === (x.word as Word).id) ? w : [...w, x.word as Word]) : w.filter((y) => y.id !== x.id) }; }); }
    else if (ev === "presence") setOnline(x.online as string[]);
    else if (ev === "reload") router.refresh();
    else if (ev === "finished" && !teacher) setFinished(true);
    else if (ev === "cheer" && !teacher && !d.preview && x.sid === own) setCheers((c) => (c.some((y) => y.id === (x.award as NewAward).id) ? c : [...c, x.award as NewAward]));
  }, [d.me.id, teacher, router, own, spotlight]);
  const { connected, send: liveSend } = useLive(d.id, onEvent);
  // просмотр «как видит ученик»: ничего не отправляем — только смотрим, живые изменения приходят
  const rawSend = useMemo(() => (d.preview ? (async () => ({ ok: true })) as typeof liveSend : liveSend), [d.preview, liveSend]);
  const [studentView, setStudentView] = useState(false);
  // учитель в группе действует за выбранного ученика: ответы, проверка, слова, отзыв
  const send = useCallback((type: string, data: Record<string, unknown> = {}) => rawSend(type, gTeacher ? { studentId: viewRef.current, ...data } : data), [rawSend, gTeacher]);
  // групповой урок: над каждым заданием — чьи ответы смотрим (по умолчанию первый ученик)
  const [taskView, setTaskView] = useState<Record<string, string>>({});
  // новая секция прямо на уроке: сохраняется в урок, у всех обновляется
  const [addSec, setAddSec] = useState(false);
  const [secName, setSecName] = useState("");
  const addSection = async (title: string) => {
    const x = title.trim().slice(0, 80);
    if (!x || !d.templateId) return;
    const r = { id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()), title: x };
    setAddSec(false); setSecName("");
    await setRubrics(d.templateId, [...d.rubrics, r]);
    setRubric(r.id); setTab("lesson"); patchLive({ rubricId: r.id });
    await send("reload"); router.refresh();
  };
  const sidFor = (taskId: string): string | null => (gTeacher ? taskView[taskId] || null : viewSid);
  // учитель в группе без выбранного ученика пробует задание сам — его ответы никуда не сохраняются
  const [sandbox, setSandbox] = useState<Answers>({});
  // «Сбросить ответы»: счётчик пересоздаёт задание с чистого листа
  const [resetTick, setResetTick] = useState<Record<string, number>>({});
  const setAnswerFor = useCallback((sid: string, taskId: string, key: string, value: unknown) => {
    setAnsBy((all) => { const a = all[sid] ?? {}; return { ...all, [sid]: { ...a, [taskId]: { ...(a[taskId] ?? {}), [key]: value } } }; });
    const k = sid + taskId + key;
    clearTimeout(pending.current[k]);
    pending.current[k] = setTimeout(() => rawSend("answer", { taskId, key, value, studentId: sid }), key === "val" || key === "text" || key === "cell" || key === "fix" ? 350 : 0);
  }, [rawSend]);

  // ответы: сразу в интерфейс, на сервер — с небольшой задержкой (набор текста)
  const setAnswer = useCallback((taskId: string, key: string, value: unknown) => {
    const sid = viewRef.current;
    setAnsBy((all) => { const a = all[sid] ?? {}; return { ...all, [sid]: { ...a, [taskId]: { ...(a[taskId] ?? {}), [key]: value } } }; });
    const k = sid + taskId + key;
    clearTimeout(pending.current[k]);
    pending.current[k] = setTimeout(() => send("answer", { taskId, key, value }), key === "val" || key === "text" || key === "cell" || key === "fix" ? 350 : 0);
  }, [send]);

  const patchLive = (p: LiveState) => { setLive((l) => ({ ...l, ...p })); send("live", { patch: p }); };
  const hidden = new Set(live.hidden ?? []);
  // «Выдели слова»: выделения учителя живут в состоянии урока; ученику показываются, только если учитель нажал «Показать ученику»
  // что смотрит учитель в «Выдели слова» на индивидуальном уроке (свои / ученика) — не сбрасывается при смене секции
  const [markView, setMarkView] = useState<Record<string, "mine" | "student">>({});
  const marks: MarkLayer = useMemo(() => ({
    teacher, group: !!d.group, student: d.group ? "" : d.student?.name ?? "",
    mine: Object.fromEntries(Object.entries(live.marks ?? {}).map(([k, v]) => [k, markMap(v)])), shown: live.marksShown ?? [],
    setMine: (taskId, m) => patchLive({ marks: { ...(live.marks ?? {}), [taskId]: m } }),
    toggleShown: (taskId) => { const s = live.marksShown ?? []; patchLive({ marksShown: s.includes(taskId) ? s.filter((x) => x !== taskId) : [...s, taskId] }); },
    view: markView, setView: (taskId, v) => setMarkView((x) => ({ ...x, [taskId]: v })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [teacher, d.group, d.student?.name, live.marks, live.marksShown, markView]);
  const lessonTasks = d.tasks.filter((x) => x.section === "lesson" && !x.hidden && (teacher || !hidden.has(x.id)));
  const ri = Math.max(0, d.rubrics.findIndex((r) => r.id === rubric));
  const cur = d.rubrics[ri];
  const inRubric = lessonTasks.filter((x) => x.rubricId === cur?.id || (!x.rubricId && ri === 0) || (x.rubricId && !d.rubrics.some((r) => r.id === x.rubricId) && ri === 0));
  // домашка: задания раздела «Домашка» + отправленные с урока; порядок — как переставил учитель (новые — в конце)
  const hwBase = [...d.tasks.filter((x) => x.section === "homework" && !x.hidden && !(hw.removedTaskIds ?? []).includes(x.id)), ...d.tasks.filter((x) => hw.extraTaskIds.includes(x.id))];
  // крестик: убрать из домашки (по ошибке добавили)
  const removeHw = (task: CTask) => { if (!confirm(t("cls.hwRemoveQ", { n: task.title || t("cls.thisTask") }))) return; setHw((h) => ({ ...h, extraTaskIds: h.extraTaskIds.filter((x) => x !== task.id), removedTaskIds: h.extraTaskIds.includes(task.id) ? h.removedTaskIds : [...(h.removedTaskIds ?? []), task.id] })); void send("hwRemove", { taskId: task.id }); };
  const hwOrder = hw.taskOrder ?? [];
  const hwTasks = [...hwBase].sort((a, b) => { const ia = hwOrder.indexOf(a.id), ib = hwOrder.indexOf(b.id); return (ia < 0 ? 1e6 + hwBase.indexOf(a) : ia) - (ib < 0 ? 1e6 + hwBase.indexOf(b) : ib); });
  const setHwOrder = (ids: string[]) => { setHw((h) => ({ ...h, taskOrder: ids })); void send("hwOrder", { order: ids }); };
  /** переставить задание домашки: на позицию to (или на шаг вверх/вниз) */
  const moveHw = (id: string, to: number) => {
    const ids = hwTasks.map((x) => x.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(ids.length, to)), 0, id);
    setHwOrder(ids);
  };
  const [dragHw, setDragHw] = useState<string | null>(null);
  const [overHw, setOverHw] = useState<{ id: string; after: boolean } | null>(null);
  const go = (id: string) => { setRubric(id); if (teacher) patchLive({ rubricId: id }); };
  const studentOnline = d.group ? d.group.members.some((m) => m.userId && online.includes(m.userId)) : d.student?.userId ? online.includes(d.student.userId) : false;
  const teacherOnline = online.includes(d.teacher.id);
  const other = teacher ? studentOnline : teacherOnline;
  // участники урока для шапки: учитель, затем ученики (в группе — все)
  const people: { id: string; name: string }[] = [
    { id: d.teacher.id, name: d.teacher.name },
    ...(d.group
      ? (teacher ? d.group.members.filter((m) => m.userId).map((m) => ({ id: m.userId!, name: m.name })) : Object.entries(d.chatNames ?? {}).map(([id, name]) => ({ id, name })))
      : d.student?.userId ? [{ id: d.student.userId, name: d.student.name }] : []),
  ];
  const timerLeft = live.timer ? Math.max(0, live.timer.left ?? Math.round((live.timer.endsAt - now) / 1000)) : 0;
  const timerPaused = live.timer?.left !== undefined;
  const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const [timerTask, setTimerTask] = useState<string | null>(null); // таймер к заданию: панель открыта для него
  const [catalog, setCatalog] = useState<{ index: number } | null>(null);
  const [editing, setEditing] = useState<{ task: CTask; index: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dlg, setDlg] = useState<"about" | "hwc" | "fb" | "finish" | "pick" | "cheer" | null>(null);
  const templateId = !!d.templateId;

  const taskActions = (task: CTask, inHw: boolean) => {
    if (!teacher) return (
      <span className="bld-acts gap-1.5">
        <button type="button" className="iconbtn" title={t("cls.pointT")} aria-label={t("cls.pointT")} onClick={() => { void send("point", { taskId: task.id, where: inHw ? "homework" : "lesson" }); setFlash(null); requestAnimationFrame(() => setFlash(task.id)); setTimeout(() => setFlash(null), 1800); }}><Icon name="pointer" size="sm" /></button>
        <AskButton task={task} send={send} context={`${d.crumbs ?? ""} · ${cur?.title ?? ""}`} />
      </span>
    );
    const sid = sidFor(task.id);
    const statuses = gTeacher ? (sid ? d.byStudent?.[sid]?.statuses ?? {} : {}) : statusesAll;
    const reviews = sid ? revBy[sid] ?? {} : {};
    const isHidden = hidden.has(task.id);
    const isHw = hw.extraTaskIds.includes(task.id);
    const hasAnswer = gTeacher ? (sid ? !!ansBy[sid]?.[task.id] : Object.values(ansBy).some((a) => a[task.id]) || !!sandbox[task.id]) : !!answers[task.id];
    const reset = () => {
      const who = gTeacher ? sid : null;
      const name = who ? d.group?.members.find((m) => m.sid === who)?.name : null;
      if (!confirm(gTeacher && !who ? t("cls.resetAllQ") : t("cls.resetQ", { name: name ?? d.student?.name ?? "" }))) return;
      setSandbox((sb) => Object.fromEntries(Object.entries(sb).filter(([k]) => k !== task.id)));
      void rawSend("reset", { taskId: task.id, ...(who ? { studentId: who } : {}) });
    };
    return (
      <span className="bld-acts">
        {/* групповой урок: чьи ответы смотреть — компактно, рядом с инструментами; повторное нажатие — снять выбор */}
        {gTeacher && <StudentChips task={task} members={d.group!.members} ansBy={ansBy} sel={sid} online={online} onPick={(x) => setTaskView((v) => ({ ...v, [task.id]: v[task.id] === x ? "" : x }))} />}
        {inHw && <span className={`pill ${statuses[task.id] === "NEEDS_REVIEW" && !reviews[task.id] ? "orange" : "grey"}`}>{statusLabel(statuses[task.id], !!reviews[task.id], t)}</span>}
        {inHw && (() => { const i = hwTasks.findIndex((x) => x.id === task.id); return (
          <>
            <button type="button" className="iconbtn" title={t("cls.hwUp")} aria-label={t("cls.hwUp")} disabled={i <= 0} onClick={() => moveHw(task.id, i - 1)}>↑</button>
            <button type="button" className="iconbtn" title={t("cls.hwDown")} aria-label={t("cls.hwDown")} disabled={i < 0 || i >= hwTasks.length - 1} onClick={() => moveHw(task.id, i + 1)}>↓</button>
            <button type="button" className="iconbtn" title={t("cls.hwRemove")} aria-label={t("cls.hwRemove")} onClick={() => removeHw(task)}><Icon name="close" size="sm" /></button>
          </>
        ); })()}
        <button data-keep-panel className={`iconbtn ${live.timer?.taskId === task.id && timerLeft > 0 ? "bd-on" : ""}`} title={t("cls.taskTimer")} aria-label={t("cls.taskTimer")} onClick={() => { setTimerTask(task.id); setPanel("timer"); }}><Icon name="clock" size="sm" /></button>
        <button className={`iconbtn ${live.spotlight?.taskId === task.id ? "bd-on" : ""}`} title={t("cls.show")} aria-label={t("cls.show")} onClick={() => { patchLive({ spotlight: { taskId: task.id, at: Date.now() }, ...(inHw ? { tab: "homework" } : { rubricId: cur?.id ?? null, tab: "lesson" }) }); setFlash(null); requestAnimationFrame(() => setFlash(task.id)); setTimeout(() => setFlash(null), 3600); }}><Icon name="pointer" size="sm" /></button>
        {!inHw && <button className={`iconbtn ${isHw ? "bd-on" : ""}`} title={isHw ? t("cls.fromHw") : t("bld.toHw")} aria-label={t("bld.toHw")} onClick={() => { const on = !isHw; setHw((h) => ({ ...h, extraTaskIds: on ? [...h.extraTaskIds, task.id] : h.extraTaskIds.filter((x) => x !== task.id) })); send("hw", { taskId: task.id, on }); }}><Icon name="home" size="sm" /></button>}
        {isHidden && <span className="pill violet">{t("bld.notSeen")}</span>}
        {/* глазик: открыт — ученик видит; закрыт — скрыто от ученика (для учителя задание остаётся обычным, не полупрозрачным) */}
        <button className={`iconbtn ${isHidden ? "text-violet" : ""}`} title={isHidden ? t("bld.eyeOff") : t("bld.eyeOn")} aria-label={isHidden ? t("bld.eyeOff") : t("bld.eyeOn")} aria-pressed={isHidden} onClick={() => patchLive({ hidden: isHidden ? [...hidden].filter((x) => x !== task.id) : [...hidden, task.id] })}><Icon name={isHidden ? "eyeoff" : "eye"} size="sm" /></button>
        {hasAnswer && <button type="button" className="iconbtn" title={gTeacher && !sid ? t("cls.resetAll") : t("cls.reset")} aria-label={gTeacher && !sid ? t("cls.resetAll") : t("cls.reset")} onClick={reset}><Icon name="undo" size="sm" /></button>}
        <button type="button" className="iconbtn" title={t("bld.editTask")} aria-label={t("bld.editTask")} onClick={() => setEditing({ task, index: -1 })}><Icon name="pencil" size="sm" /></button>
      </span>
    );
  };

  // задание сделано — мягкий зелёный фон: видно, с чем уже поработали. В группе — когда сделали все ученики
  const doneBy = (task: CTask, a: Record<string, unknown> | undefined) => { const st = progressOf(task, a); return !!st && st.length > 0 && summary(st).done; };
  const isDone = (task: CTask) => gTeacher
    ? d.group!.members.length > 0 && d.group!.members.every((m) => doneBy(task, ansBy[m.sid]?.[task.id] as Record<string, unknown> | undefined))
    : doneBy(task, answers[task.id] as Record<string, unknown> | undefined);
  const renderTasks = (list: CTask[], inHw = false) => (
    <>
      {teacher && !inHw && <Plus onClick={() => setCatalog({ index: 0 })} />}
      {list.length === 0 && <div className="tk-empty"><Icon name="book" />{inHw ? t("cls.noHw") : t("bld.emptyStudent")}</div>}
      {list.map((task, i) => {
        const card = <TaskCard key={resetTick[task.id] ?? 0} task={task} index={list.filter((x, j) => j <= i && numbered(x)).length - 1} actions={taskActions(task, inHw)} />;
        // групповой урок: выбран ученик — его ответы, только просмотр (учитель ничего не меняет у ученика);
        // никто не выбран — учитель пробует задание сам, это никуда не сохраняется
        const sid = sidFor(task.id);
        const m = sid ? d.group?.members.find((x) => x.sid === sid) : undefined;
        const sendFor = (type: string, x: Record<string, unknown> = {}) => rawSend(type, { ...x, studentId: sid });
        return (
        <div key={task.id} id={`task-${task.id}`}
          {...(inHw && teacher ? {
            draggable: dragHw === task.id,
            onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.id); },
            onDragOver: (e: React.DragEvent) => { if (!dragHw || dragHw === task.id) return; e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; if (overHw?.id !== task.id || overHw.after !== after) setOverHw({ id: task.id, after }); },
            onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragHw && overHw) { const ids = hwTasks.map((x) => x.id).filter((x) => x !== dragHw); const at = ids.indexOf(overHw.id) + (overHw.after ? 1 : 0); moveHw(dragHw, at); } setDragHw(null); setOverHw(null); },
            onDragEnd: () => { setDragHw(null); setOverHw(null); },
          } : {})}
          className={`${inHw && teacher ? "hwdrag" : ""} ${dragHw === task.id ? "hwdrag-src" : ""} ${overHw?.id === task.id ? (overHw.after ? "hwdrop-after" : "hwdrop-before") : ""} ${isDone(task) ? "tk-donebg" : ""} ${live.timer?.taskId === task.id && timerLeft > 0 ? "tk-timed" : ""} ${flash === task.id ? "cls-flash" : ""} ${teacher && hidden.has(task.id) ? "tk-teacheronly" : ""} ${gTeacher && sid ? "tk-viewing" : ""}`}>
          {/* ручка: зажать и перетащить задание домашки выше или ниже */}
          {inHw && teacher && <button type="button" className="hwgrip" title={t("cls.hwDrag")} aria-label={t("cls.hwDrag")} onPointerDown={() => setDragHw(task.id)} onPointerUp={() => !overHw && setDragHw(null)}><span aria-hidden="true">⠿</span></button>}
          {live.timer?.taskId === task.id && timerLeft > 0 && <div className={`tk-timer ${timerPaused ? "paused" : ""}`} aria-live="polite"><Icon name="clock" size="sm" />{fmtT(timerLeft)}{timerPaused ? ` · ${t("cls.tPaused")}` : ""}</div>}
          {gTeacher ? (
            <AnswerProvider key={`${sid ?? "me"}-${resetTick[task.id] ?? 0}`} answers={sid ? ansBy[sid] ?? {} : sandbox}
              onSet={(tid, k, v) => { if (!sid) setSandbox((sb) => ({ ...sb, [tid]: { ...(sb[tid] ?? {}), [k]: v } })); else if (k === "gnotes") setAnswerFor(sid, tid, k, v); }} role="teacher">
              <MarkCtx.Provider value={{ ...marks, student: m?.name ?? "", members: d.group!.members, sid: sid ?? "", pick: (taskId, x) => setTaskView((v) => ({ ...v, [taskId]: x })) }}>{card}</MarkCtx.Provider>
            </AnswerProvider>
          ) : card}
          {gTeacher && sid && <div className="tk-viewing-note small muted">{t("grp.viewing", { name: m?.name ?? "" })}</div>}
          {inHw && teacher && (!gTeacher || sid) && (TYPES[task.type].teacherCheck || task.type === "transform" || task.type === "translate") && <ReviewBox key={sid ?? "_"} lessonId={m?.instanceId ?? d.id} task={task} review={(revBy[sid ?? own] ?? {})[task.id]} draft={(gTeacher ? d.byStudent?.[sid ?? ""]?.aiDrafts ?? {} : aiDrafts)[task.id]} answered={!!(ansBy[sid ?? own] ?? {})[task.id]} send={gTeacher ? sendFor : send} />}
          {inHw && !teacher && reviews[task.id] && <div className={`alert mt-2 ${reviews[task.id].ok ? "ok" : ""}`}>{reviews[task.id].ok ? "✓ " : ""}{t("cls.teacherSays")}: {reviews[task.id].comment || (reviews[task.id].ok ? t("cls.reviewedOk") : "—")}</div>}
          {inHw && !teacher && reviews[task.id]?.ai && <div className="mt-2"><AiCheckView check={reviews[task.id].ai!} /></div>}
          {teacher && !inHw && <Plus onClick={() => setCatalog({ index: i + 1 })} />}
        </div>
        );
      })}
    </>
  );

  return (
    <AnswerProvider answers={answers} onSet={setAnswer} role={d.role}>
     <MarkCtx.Provider value={marks}>
      <div className={`cls ${teacher ? "as-teacher" : "as-student"}`}>
        {teacher && pointBy && <div className="cls-toast" role="status"><Icon name="pointer" size="sm" />{t("cls.pointedBy", { name: pointBy.name })}</div>}
        {d.preview && <div className="cls-previewbar"><Icon name="eye" size="sm" />{t("cls.previewBar")}</div>}
        {teacher && studentView && (
          <div className="cls-preview" role="dialog" aria-label={t("cls.asStudent")}>
            <div className="cls-preview-top"><b>{t("cls.asStudent")}</b><span className="small muted grow">{t("cls.asStudentOf", { name: (d.group ? d.group.members.find((m) => m.sid === viewSid)?.name ?? d.group.members[0]?.name : d.student?.name) ?? "" })}</span>
              <button type="button" className="btn secondary sm" onClick={() => setStudentView(false)}><Icon name="close" size="sm" />{t("common.close")}</button></div>
            <iframe title={t("cls.asStudent")} src={`/class/${d.group ? d.group.members.find((m) => m.sid === viewSid)?.instanceId ?? d.group.members[0]?.instanceId : d.id}?preview=student`} />
          </div>
        )}
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
            {/* ответы видит только учитель; выключить — например, на время демонстрации экрана */}
            {teacher && <button type="button" className={`btn sm ${showKeys ? "tinted" : "secondary"}`} aria-pressed={showKeys} title={showKeys ? t("cls.keysHide") : t("cls.keysShow")} onClick={() => setShowKeys((v) => { try { localStorage.setItem("vibeon.keys", v ? "0" : "1"); } catch { /* приватный режим */ } return !v; })}><Icon name={showKeys ? "eye" : "eyeoff"} size="sm" />{t("cls.keys")}</button>}
            {teacher && <button className="btn secondary sm" onClick={() => setStudentView(true)} title={t("cls.asStudentHint")}><Icon name="eye" size="sm" />{t("cls.asStudent")}</button>}
            {teacher && <button className="btn secondary sm" onClick={() => setDlg("about")}><Icon name="info" size="sm" />{t("cls.about")}</button>}
            <LangSwitch lang={lang} label={t("common.language")} />
            <span className={`dot`} title={connected ? t("cls.online") : t("cls.offline")} style={{ background: connected ? "var(--ok)" : "var(--warn)" }} />
            {/* кто в классе: учитель и ученики, зелёная точка — сейчас онлайн */}
            <span className="cls-people" aria-label={t("cls.whoIn")}>
              {people.map((x) => (
                <span key={x.id} className={`cls-person ${online.includes(x.id) || x.id === d.me.id ? "on" : ""}`} title={`${x.name}${x.id === d.me.id ? ` (${t("cls.you")})` : ""} — ${online.includes(x.id) || x.id === d.me.id ? t("cls.isOnline") : t("cls.isOffline")}`}>
                  {x.name.slice(0, 1).toUpperCase()}<i />
                </span>
              ))}
            </span>
            <Link href={d.homeHref} className="iconbtn" title={t("cls.exit")} aria-label={t("cls.exit")}><Icon name="logout" size="sm" /></Link>
          </div>
        </header>

        <div className="cls-grid">
          <nav className="cls-rail">
            <button aria-pressed={panel === "chat"} onClick={() => { setPanel(panel === "chat" ? null : "chat"); setUnread(0); }}><Icon name="msg" /><span>{d.group ? t("grp.chat") : t("nav.chat")}</span>{unread > 0 && <i className="count">{unread}</i>}</button>
            <button aria-pressed={panel === "dict"} onClick={() => setPanel(panel === "dict" ? null : "dict")}><Icon name="book" /><span>{t("cls.dict")}</span></button>
            {teacher && <button aria-pressed={panel === "timer"} onClick={() => setPanel(panel === "timer" ? null : "timer")}><Icon name="clock" /><span>{t("cls.timer")}</span></button>}
            {live.timer && timerLeft > 0 && <div className={`cls-timer ${timerPaused ? "paused" : ""}`}>{fmtT(timerLeft)}</div>}
          </nav>

          {panel && (
            <aside className="cls-panel">
              <button className="iconbtn dlgx" onClick={() => setPanel(null)} aria-label="close"><Icon name="close" size="sm" /></button>
              {panel === "chat" && <Chat msgs={msgs} me={d.me.id} send={send} names={{ [d.teacher.id]: d.teacher.name, ...(d.chatNames ?? {}), ...(d.student?.userId ? { [d.student.userId]: d.student.name } : {}) }} />}
              {panel === "dict" && <Dict send={send} />}
              {panel === "timer" && <Timer left={live.timer ? timerLeft : 0} paused={timerPaused} task={timerTask ? lessonTasks.concat(hwTasks).find((x) => x.id === timerTask)?.title || t("cls.thisTask") : null}
                onClearTask={() => setTimerTask(null)}
                onSet={(x) => patchLive({ timer: x === null ? null : x.paused ? { endsAt: 0, left: x.sec, ...(timerTask ? { taskId: timerTask } : {}) } : { endsAt: Date.now() + x.sec * 1000, ...(timerTask ? { taskId: timerTask } : {}) } })} />}
            </aside>
          )}

          <main className="cls-main">
           <KeyCtx.Provider value={teacher && showKeys}>
            {gTeacher && tab === "words" && (
              <div className="cls-who" role="group" aria-label={t("grp.answersOf")}>
                <span className="cls-who-l"><Icon name="group" size="sm" />{d.group!.title}</span>
                <span className="small muted">{t("grp.answersOf")}:</span>
                {d.group!.members.map((m) => (
                  <button key={m.sid} type="button" aria-pressed={viewSid === m.sid} onClick={() => setViewSid(m.sid)} title={m.userId && online.includes(m.userId) ? t("grp.inClass") : t("grp.notInClass")}>
                    <i className="dot" style={{ background: m.userId && online.includes(m.userId) ? "var(--ok)" : "var(--grey)" }} />{m.name}
                  </button>
                ))}
              </div>
            )}
            {teacher && addHwTip && tab === "lesson" && (
              <div className="alert ok mb-4 flex items-start justify-between gap-3">
                <span><b className="block">{t("cls.addHwTitle")}</b>{t("cls.addHwText")}</span>
                <button type="button" className="iconbtn" aria-label={t("fs.hide")} onClick={() => setAddHwTip(false)}><Icon name="close" size="sm" /></button>
              </div>
            )}
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
              <Homework teacher={teacher} tasks={hwTasks} removed={teacher ? (hw.removedTaskIds ?? []).length : 0} onRestore={() => { setHw((h) => ({ ...h, removedTaskIds: [] })); void send("hwRestore", {}); }} statuses={statuses} reviews={reviews} training={hw.wordTraining} comment={hw.teacherComment} render={renderTasks}
                cards={[...d.lessonWords.map((w) => ({ word: w.word, tr: w.tr, ex: w.ex })), ...words.filter((w) => !d.lessonWords.some((l) => l.word.toLowerCase() === w.word.toLowerCase())).map((w) => ({ word: w.word, tr: w.translation ?? "", ex: w.example ?? "" }))].filter((w) => w.tr || w.ex)} />
            )}
            {tab === "words" && <Words key={viewSid} teacher={teacher} lessonWords={d.lessonWords} words={words} training={hw.wordTraining} send={send} setHw={setHw} />}
            {tab === "board" && (
              <Board pages={board} setPages={setBoard} page={page} setPage={setPage} role={d.role} me={d.me.id} locked={!!live.lockBoard} follow={!!live.follow}
                send={(type, data) => send(type, data)} onLive={(p) => patchLive(p as LiveState)} />
            )}
           </KeyCtx.Provider>
          </main>

          <aside className="cls-side">
            {d.callLink ? (
              <a href={d.callLink} target="_blank" rel="noreferrer" className="btn w-full cls-call"><Icon name="phone" size="sm" />{t("cls.joinCall")}</a>
            ) : <span className="btn w-full cls-call off" title={t("cls.noCallHint")}><Icon name="phone" size="sm" />{t("cls.noCall")}</span>}
            {teacher && <CallLinkEdit lessonId={d.id} value={d.callOwn ? d.callLink ?? "" : ""} group={!!d.group} />}
            <div className="mt-2 flex items-center justify-center gap-2 small muted">
              <span className="relative"><span className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{gTeacher ? <Icon name="group" size="sm" /> : (teacher ? d.student?.name : d.teacher.name)?.[0] ?? "?"}</span><i className="dot" style={{ position: "absolute", right: -2, bottom: -2, background: other ? "var(--ok)" : "var(--grey)" }} /></span>
              {gTeacher ? t("grp.online", { n: d.group!.members.filter((m) => m.userId && online.includes(m.userId)).length, total: d.group!.members.length })
                : other ? (teacher ? t("cls.studentIn", { name: d.student?.name ?? "" }) : t("cls.teacherIn")) : (teacher ? t("cls.studentOut", { name: d.student?.name ?? t("cls.student") }) : t("cls.teacherOut"))}
            </div>
            {/* заметки урока: общие для ученика и учителя — наверху, сразу на виду (на месте прежней картинки курса) */}
            <SharedNotes
              key={noteSid}
              value={snotes[noteSid] ?? ""}
              onChange={(v) => { setSnotes((n) => ({ ...n, [noteSid]: v })); return rawSend("snote", { text: v, ...(gTeacher ? { studentId: noteSid } : {}) }); }}
              who={gTeacher ? <div className="flex flex-wrap gap-1">
                {/* «Все» — заметки всех учеников друг под другом; имя — заметка одного ученика, её можно править */}
                <button type="button" className={`pchip ${noteSid === "*" ? "on" : ""}`} aria-pressed={noteSid === "*"} onClick={() => setNoteSid("*")}>{t("cls.snoteAll")}</button>
                {d.group!.members.map((m) => <button key={m.sid} type="button" className={`pchip ${noteSid === m.sid ? "on" : ""}`} aria-pressed={noteSid === m.sid} onClick={() => setNoteSid(m.sid)}>{m.name.split(" ")[0]}</button>)}</div> : null}
              all={gTeacher && noteSid === "*" ? d.group!.members.map((m) => ({ sid: m.sid, name: m.name, text: snotes[m.sid] ?? "" })) : undefined}
              onPick={(sid) => setNoteSid(sid)}
              flash={noteFlash}
              point={teacher ? {
                // в группе: выбран ученик — показываем только ему, «Все» — всем; на индивидуальном — ученику
                label: gTeacher && noteSid !== "*" ? t("cls.snotePointOne", { name: d.group!.members.find((m) => m.sid === noteSid)?.name.split(" ")[0] ?? "" }) : gTeacher ? t("cls.snotePointAll") : t("cls.snotePoint"),
                go: () => { void rawSend("notepoint", gTeacher && noteSid !== "*" ? { studentId: noteSid } : {}); },
              } : undefined}
              hint={teacher ? (d.group ? t("cls.snoteHintGroup") : t("cls.snoteHintTeacher", { name: d.student?.name ?? "" })) : t("cls.snoteHint")}
            />
            {/* курс и урок — подписью над секциями */}
            <div className="cls-what mt-4">
              {d.course?.title && <small>{t("cls.courseOf", { c: d.course.title })}</small>}
              <b>{d.title ?? t("cls.lesson")}</b>
              {teacher ? <button type="button" className="btn tinted sm mt-1 self-start" onClick={() => setDlg("pick")}><Icon name="book" size="sm" />{t("cls.lpOther2")}</button>
                : <Link href="/student/lessons" className="alink small mt-1">{t("cls.lpMine")}</Link>}
            </div>
            <div className="mt-3 flex flex-col gap-1">
              {d.rubrics.map((r, i) => (
                <button key={r.id} className={`bld-sec ${tab === "lesson" && r.id === cur?.id ? "on" : ""}`} onClick={() => { setTab("lesson"); go(r.id); }}>
                  <span className="grow">{r.title}</span>{teacher && live.rubricId === r.id && <i className="dot" style={{ background: "var(--accent)" }} title={t("cls.studentHere")} />}
                  <small>{lessonTasks.filter((x) => x.rubricId === r.id || (!x.rubricId && i === 0)).length}</small>
                </button>
              ))}
            </div>
            {teacher && templateId && (addSec ? (
              <div className="bs-new mt-2">
                <input className="input" autoFocus value={secName} placeholder={t("bld.secName")} aria-label={t("bld.secName")} onChange={(e) => setSecName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void addSection(secName); if (e.key === "Escape") setAddSec(false); }} />
                <div className="flex flex-wrap gap-1.5">{RUBRICS.filter((x) => !d.rubrics.some((r) => r.title.toLowerCase() === x.toLowerCase())).map((x) => <button key={x} type="button" className="pchip" onClick={() => void addSection(x)}>{x}</button>)}</div>
                <div className="flex gap-2"><button type="button" className="btn primary sm" disabled={!secName.trim()} onClick={() => void addSection(secName)}>{t("bld.secAdd")}</button><button type="button" className="btn plain sm" onClick={() => setAddSec(false)}>{t("common.cancel")}</button></div>
              </div>
            ) : <button type="button" className="bld-sec cls-addsec mt-1" onClick={() => setAddSec(true)}><Icon name="plus" size="sm" /><span className="grow">{t("bld.addRubric")}</span></button>)}
            {teacher && <NoteBox key="note" title={t("cls.teacherNote")} value={notes.teacher} onSave={(v) => send("note", { text: v })} />}
            {!teacher && notes.teacher && <div className="alert mt-3" style={{ background: "var(--warn-bg)", color: "var(--warn-text)" }}><b className="block small">{t("cls.fromTeacher")}</b>{notes.teacher}</div>}
            {teacher && (
              <div className="mt-4 flex flex-col gap-2">
                <button className="btn secondary w-full" onClick={() => setDlg("hwc")}><Icon name="inbox" size="sm" />{t("cls.hwComment")}{hw.teacherComment ? " (1)" : ""}</button>
                <button className="btn secondary w-full" onClick={() => setDlg("fb")}><Icon name="msg" size="sm" />{t("cls.feedback")}</button>
                <button className="btn secondary w-full cls-cheer" onClick={() => setDlg("cheer")}><span aria-hidden="true">💛</span>{t("chr.btn")}</button>
                <button className="btn primary w-full" onClick={() => setDlg("finish")}><Icon name="check" size="sm" />{t("cls.finish")}</button>
              </div>
            )}
            {!teacher && tab !== "homework" && hw.teacherComment && <div className="alert mt-3" style={{ background: "var(--accent-bg)", color: "var(--accent-text)" }}><b className="block small">{t("cls.hwComment")}</b>{hw.teacherComment}</div>}
            {/* сведения об уроке, цели и ход урока — внизу панели, раскрываются вниз */}
            {teacher && d.teacherInfo && <div className="mt-4"><TeacherInfo info={d.teacherInfo} /></div>}
          </aside>
        </div>

        {catalog && <Catalog fav={[]} onClose={() => setCatalog(null)} onPick={(ty: TaskType) => { const idx = catalog.index; setCatalog(null); setEditing({ index: idx, task: { id: "new", type: ty, title: PRESET[ty]?.[0] ?? "", content: SAMPLE[ty] ?? "", options: ty === "note" ? { teacherOnly: true } : {}, section: "lesson", rubricId: cur?.id ?? null, hidden: false } }); }} />}
        {editing && (
          <TaskEditor lessonId={templateOf(d)} initial={editing.task} pending={saving} error={null} onClose={() => setEditing(null)}
            onSave={async (task) => {
              setSaving(true);
              if (editing.task.id !== "new") // правка задания прямо на уроке: ученики увидят изменения сразу
                await saveTask(templateOf(d), editing.task.id, { section: editing.task.section, rubricId: editing.task.rubricId, type: task.type, title: task.title, content: task.content, options: task.options });
              else {
                const index = d.tasks.filter((x) => x.section === "lesson" && x.rubricId === editing.task.rubricId).findIndex((x) => x.id === inRubric[editing.index]?.id);
                await saveTask(templateOf(d), null, { section: "lesson", rubricId: editing.task.rubricId, type: task.type, title: task.title, content: task.content, options: task.options }, index < 0 ? undefined : index);
              }
              setSaving(false); setEditing(null); await send("reload"); router.refresh();
            }} />
        )}
        <ClassDialogs which={dlg === "cheer" ? null : dlg} close={() => setDlg(null)} d={d} hwComment={hw.teacherComment} send={send} onFinished={() => router.push(d.homeHref)} onCheer={() => setDlg("cheer")} />
        {dlg === "cheer" && (
          <LessonCheer catalog={d.cheers ?? []} onClose={() => setDlg(null)} onGiven={(awardId) => rawSend("cheer", { awardId })}
            to={d.group ? d.group.members.map((m) => ({ sid: m.sid, name: m.name, gender: m.gender ?? null, inClass: !!m.userId && online.includes(m.userId) }))
              : d.student ? [{ sid: d.student.id, name: [d.student.name, d.student.lastName].filter(Boolean).join(" "), gender: d.student.gender ?? null, inClass: !!d.student.userId && online.includes(d.student.userId) }] : []} />
        )}
        {cheers.length > 0 && <CelebrateAwards key={cheers.map((c) => c.id).join()} items={cheers} inClass />}
        {finished && (
          <Dialog open onClose={() => setFinished(false)} title={t("cls.over")}>
            <p className="muted mt-0">{hwTasks.length + hw.wordTraining.length > 0 ? t("cls.overHw") : t("cls.overNoHw")}</p>
            <div className="actions"><button className="btn secondary" onClick={() => { setFinished(false); setTab("homework"); }}>{t("nav.homework")}</button><Link className="btn primary" href={d.homeHref}>{t("cls.toCabinet")}</Link></div>
          </Dialog>
        )}
      </div>
     </MarkCtx.Provider>
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

function Homework({ teacher, tasks, statuses, reviews, training, comment, render, cards, removed = 0, onRestore }: {
  removed?: number; onRestore?: () => void;
  teacher: boolean; tasks: (TaskData & { section: string })[]; statuses: Record<string, string>; reviews: Record<string, Review>; training: string[]; comment: string | null;
  render: (list: never[], inHw?: boolean) => React.ReactNode; cards: { word: string; tr: string; ex: string }[];
}) {
  const { t } = useT();
  const [train, setTrain] = useState(false);
  const say = (w: string) => { const u = new SpeechSynthesisUtterance(w); u.lang = "en-GB"; u.rate = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); };
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
      {/* слова этого урока — одна тренировка, запускается прямо здесь (и у учителя, и у ученика) */}
      {training.length > 0 && f === "all" && (
        <div className="tk mb-4 flex items-center gap-3">
          <span className="si statt" style={{ background: "var(--accent-bg)", padding: 10 }}><Icon name="cards" /></span>
          <div className="grow"><b className="block">{t("cls.trainLesson")}</b><span className="small muted">{cards.length ? t("cls.trainLessonSub", { n: cards.length }) : t("cls.noWords")}</span></div>
          <button type="button" className="btn primary sm" disabled={!cards.length} onClick={() => setTrain(true)}>{t("cls.start")}</button>
        </div>
      )}
      {train && <WordTrainer cards={cards} say={say} onClose={() => setTrain(false)} />}
      {render(list as never[], true)}
      {removed > 0 && f === "all" && <button type="button" className="btn plain sm mt-3" onClick={onRestore}><Icon name="undo" size="sm" />{t("cls.hwRestore", { n: removed })}</button>}
    </>
  );
}

/** Тренировка слов урока прямо в классе: карточка — слово, нажать — перевод и пример; «Знаю» / «Ещё раз» (вернётся в конец). */
function WordTrainer({ cards, say, onClose }: { cards: { word: string; tr: string; ex: string }[]; say: (w: string) => void; onClose: () => void }) {
  const { t } = useT();
  const [queue, setQueue] = useState(() => [...cards].sort(() => Math.random() - 0.5));
  const [flip, setFlip] = useState(false);
  const [known, setKnown] = useState(0);
  const cur = queue[0];
  const next = (ok: boolean) => { setFlip(false); setQueue((q) => (ok ? q.slice(1) : [...q.slice(1), q[0]])); if (ok) setKnown((k) => k + 1); };
  return (
    <Dialog open onClose={onClose} title={t("cls.trainNew")}>
      {cur ? (
        <>
          <div className="small muted mb-2">{t("cls.trainLeft", { n: queue.length, k: known })}</div>
          <button type="button" className="wcard" onClick={() => setFlip((f) => !f)} aria-label={t("cls.trainFlip")}>
            <b>{cur.word}</b>
            {flip ? <><span className="wtr">{cur.tr}</span>{cur.ex && <i className="small">{cur.ex}</i>}</> : <span className="small muted">{t("cls.trainFlip")}</span>}
          </button>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="iconbtn" style={{ background: "var(--fill)" }} onClick={() => say(cur.word)} aria-label={t("tk.listen")}><Icon name="sound" size="sm" /></button>
            <span className="grow" />
            <button type="button" className="btn secondary" onClick={() => next(false)}>{t("cls.trainAgain")}</button>
            <button type="button" className="btn primary" onClick={() => next(true)}>{t("cls.trainKnow")}</button>
          </div>
        </>
      ) : (
        <div className="text-center"><p className="text-[18px]"><b>{t("cls.trainDone", { n: known })}</b></p><button type="button" className="btn primary" onClick={onClose}>{t("common.close")}</button></div>
      )}
    </Dialog>
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
  const [train, setTrain] = useState(false);
  const cards = all.filter((w) => w.tr || w.ex);
  const unsaved = lessonWords.filter((w) => !byWord.get(w.word.toLowerCase()));
  const add = (w: { word: string; tr: string; ex: string }) => send("word", { op: "add", word: w.word, tr: w.tr, ex: w.ex });
  const bold = (ex: string, w: string) => ex.split(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i")).map((p, i) => (p.toLowerCase() === w.toLowerCase() ? <b key={i}>{p}</b> : p));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="grow">{teacher ? t("bld.newWords") : t("cls.myWords")}</h1>
        <div className="seg"><button aria-pressed={accent === "en-GB"} onClick={() => setAccent("en-GB")}>British</button><button aria-pressed={accent === "en-US"} onClick={() => setAccent("en-US")}>American</button></div>
        {/* тренировка — сразу здесь, у учителя и у ученика; «в домашку» — отдельной кнопкой */}
        <button className="btn sm primary" disabled={!cards.length} onClick={() => setTrain(true)}><Icon name="cards" size="sm" />{t("cls.trainNew")}</button>
        {teacher && <button className={`btn sm ${training.includes("new") ? "tinted" : "secondary"}`} aria-pressed={training.includes("new")} title={t("cls.trainToHw")} onClick={() => toggle("new")}><Icon name="home" size="sm" />{training.includes("new") ? t("cls.trainInHw") : t("cls.trainToHw")}</button>}
      </div>
      {unsaved.length > 0 && (
        <div className="wadd mb-3">
          <span className="grow small">{teacher ? t("cls.wordsAddHintT") : t("cls.wordsAddHint")}</span>
          <button type="button" className="btn tinted sm" onClick={() => unsaved.forEach(add)}><Icon name="plus" size="sm" />{t("cls.wordsAddAll", { n: unsaved.length })}</button>
        </div>
      )}
      {train && <WordTrainer cards={cards.map((w) => ({ word: w.word, tr: w.tr, ex: w.ex }))} say={say} onClose={() => setTrain(false)} />}
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
            {/* «+» — в личный словарь ученика (там он их тренирует); ✓ — уже там */}
            {!w.saved ? <button className="iconbtn wplus" aria-label={t("cls.wordToDict", { w: w.word })} title={t("cls.wordToDict", { w: w.word })} onClick={() => add(w)}><Icon name="plus" size="sm" /></button>
              : <span className="iconbtn wsaved" title={t("cls.wordInDict")} aria-label={t("cls.wordInDict")}><Icon name="check" size="sm" /></span>}
            {teacher && w.saved && <button className="iconbtn" aria-label={t("common.delete")} onClick={() => send("word", { op: "del", wid: w.saved!.id })}>✕</button>}
          </div>
        ))}
      </div>
    </>
  );
}

/** Ссылка на созвон из урока: сохраняется в анкету ученика (или в настройки группы) — и сразу действует во всех его уроках. */
/** «Другой урок»: сначала уроки курса, по которому идём (по разделам, с картинками); «← Курсы» — курсы этого ученика (группы)
 *  и все остальные. Выбрали урок — «Закрепить»: урок становится текущим и останется на следующих занятиях, пока не закрепите другой. */
function LessonPicker({ d, send, close }: { d: ClassData; send: (type: string, x?: Record<string, unknown>) => Promise<unknown>; close: () => void }) {
  const { t } = useT();
  const courses = d.picker?.courses ?? [];
  const curCourse = courses.find((c) => c.units.some((u) => u.lessons.some((l) => l.id === d.templateId)))?.id ?? d.picker?.used[0] ?? null;
  const [cid, setCid] = useState<string | null>(curCourse);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const course = courses.find((c) => c.id === cid);
  const used = (d.picker?.used ?? []).map((id) => courses.find((c) => c.id === id)).filter(Boolean) as typeof courses;
  const others = courses.filter((c) => !used.includes(c));
  const pin = async (id: string) => { setBusy(true); await send("template", { templateId: id }); setBusy(false); close(); };
  const card = (c: (typeof courses)[number]) => (
    <button key={c.id} type="button" className="lp-course" onClick={() => { setCid(c.id); setQ(""); }}>
      <span className="lp-cover" style={c.cover ? { backgroundImage: `url(${c.cover})` } : undefined}>{!c.cover && c.title[0]}</span>
      <b>{c.title}</b><small>{t("cls.lpLessons", { n: c.units.reduce((a, u) => a + u.lessons.length, 0) })}</small>
    </button>
  );
  return (
    <Dialog open onClose={close} title={course ? course.title : t("cls.lpCourses")} wide>
      {course ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn secondary sm" onClick={() => { setCid(null); setSel(null); }}><Icon name="chevl" size="sm" />{t("cls.lpAllCourses")}</button>
            <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("cls.lpSearch")} aria-label={t("cls.lpSearch")} style={{ minWidth: 180 }} />
          </div>
          <div className="lp-list">
            {course.units.map((u) => {
              const ls = u.lessons.filter((l) => !q.trim() || l.title.toLowerCase().includes(q.trim().toLowerCase()));
              return ls.length ? (
                <div key={u.id}>
                  <div className="lp-unit">{u.title}</div>
                  {ls.map((l) => (
                    <div key={l.id} className={`lp-row ${sel === l.id ? "on" : ""}`} onClick={() => setSel(l.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSel(l.id); }}>
                      <span className="lp-thumb" style={l.cover ? { backgroundImage: `url(${l.cover})` } : undefined}>{!l.cover && <Icon name="book" size="sm" />}</span>
                      <span className="grow min-w-0"><b className="block truncate">{l.title}</b>{l.sub && <small className="muted">{l.sub}</small>}</span>
                      {l.id === d.templateId && <span className="pill green"><Icon name="pin" size="sm" />{t("cls.lpPinned")}</span>}
                      {sel === l.id && l.id !== d.templateId && <button type="button" className="btn primary sm" disabled={busy} onClick={(e) => { e.stopPropagation(); void pin(l.id); }}><Icon name="pin" size="sm" />{t("cls.lpPin")}</button>}
                    </div>
                  ))}
                </div>
              ) : null;
            })}
          </div>
          <p className="hint mb-0">{t("cls.lpHint")}</p>
        </>
      ) : (
        <>
          {used.length > 0 && <><div className="lp-unit">{d.group ? t("cls.lpUsedGroup") : t("cls.lpUsed")}</div><div className="lp-grid">{used.map(card)}</div></>}
          {others.length > 0 && <><div className="lp-unit mt-4">{used.length ? t("cls.lpOther") : t("cls.lpCourses")}</div><div className="lp-grid">{others.map(card)}</div></>}
          {courses.length === 0 && <p className="hint">{t("crs.empty")}</p>}
          <div className="actions"><Link href="/teacher/courses" className="btn secondary sm" target="_blank"><Icon name="book" size="sm" />{t("cls.lpCatalog")}</Link></div>
        </>
      )}
    </Dialog>
  );
}

function CallLinkEdit({ lessonId, value, group }: { lessonId: string; value: string; group: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await setCallLink(lessonId, v).catch(() => ({ ok: false as const, error: "Error" }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false); router.refresh();
  };
  if (!open) return <button type="button" className="btn plain sm mt-1 w-full" onClick={() => { setV(value); setOpen(true); }}><Icon name="link" size="sm" />{value ? t("cls.linkEdit") : t("cls.linkAdd")}</button>;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <input className="input" autoFocus inputMode="url" value={v} placeholder="https://telemost.yandex.ru/…" aria-label={t("prof.callLink")} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setOpen(false); }} />
      <span className="hint">{group ? t("cls.linkHintGroup") : t("cls.linkHint")}</span>
      {err && <div className="alert">{err}</div>}
      <div className="flex gap-2"><button type="button" className="btn primary sm" disabled={busy} onClick={() => void save()}>{t("common.save")}</button><button type="button" className="btn plain sm" onClick={() => setOpen(false)}>{t("common.cancel")}</button></div>
    </div>
  );
}

/** Чат урока / группы: подписи кто пишет; у сообщения — «Ответить» (с цитатой), свои — «Изменить» и «Удалить». */
function Chat({ msgs, me, send, names }: { msgs: Msg[]; me: string; send: (type: string, d: Record<string, unknown>) => Promise<unknown>; names: Record<string, string> }) {
  const { t } = useT();
  const [v, setV] = useState("");
  const [reply, setReply] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const submit = () => {
    const text = v.trim();
    if (!text) return;
    if (editing) void send("chatEdit", { id: editing.id, text });
    else void send("chat", { text, ...(reply ? { replyTo: reply.id } : {}) });
    setV(""); setReply(null); setEditing(null);
  };
  const quote = (id: string) => { const q = byId.get(id); return q ? (q.deleted ? t("cls.msgDeleted") : q.text) : ""; };
  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-2">{t("nav.chat")}</h3>
      <div className="cls-chat">
        {msgs.length === 0 && <p className="hint">{t("cls.chatEmpty")}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.by === me ? "me" : ""} ${m.deleted ? "del" : ""}`} onClick={() => !m.deleted && setMenu(menu === m.id ? null : m.id)}>
            <small>{names[m.by] ?? ""}</small>
            {m.replyTo && <span className="bq"><b>{names[byId.get(m.replyTo)?.by ?? ""] ?? ""}</b>{quote(m.replyTo)}</span>}
            {m.deleted ? <i>{t("cls.msgDeleted")}</i> : m.text}
            {m.edited && !m.deleted && <span className="edited">{t("cls.msgEdited")}</span>}
            {menu === m.id && (
              <span className="bmenu" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => { setReply(m); setEditing(null); setMenu(null); input.current?.focus(); }}>{t("cls.msgReply")}</button>
                {m.by === me && <button type="button" onClick={() => { setEditing(m); setReply(null); setV(m.text); setMenu(null); input.current?.focus(); }}>{t("cls.msgEdit")}</button>}
                {m.by === me && <button type="button" className="bad" onClick={() => { if (confirm(t("cls.msgDelQ"))) void send("chatDel", { id: m.id }); setMenu(null); }}>{t("common.delete")}</button>}
              </span>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      {(reply || editing) && (
        <div className="chat-ctx">
          <span className="grow truncate"><b>{editing ? t("cls.msgEditing") : t("cls.msgReplyTo", { name: names[reply!.by] ?? "" })}</b> {(editing ?? reply)!.text}</span>
          <button type="button" className="iconbtn" aria-label={t("common.cancel")} onClick={() => { setReply(null); if (editing) setV(""); setEditing(null); }}><Icon name="close" size="sm" /></button>
        </div>
      )}
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input ref={input} className="input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setReply(null); setEditing(null); } }} placeholder={t("cls.message")} aria-label={t("cls.message")} />
        <button className="btn primary sm" disabled={!v.trim()} aria-label={editing ? t("common.save") : t("cls.send")}><Icon name={editing ? "check" : "send"} size="sm" /></button>
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

/** Таймер: время выставляется заранее (пресеты, +15 с, +1 мин), запускается отдельно; пауза, продолжить, сбросить.
 *  task — таймер к конкретному заданию: ученики видят отсчёт прямо у задания. */
function Timer({ left, paused, task, onSet, onClearTask }: { left: number; paused: boolean; task: string | null; onSet: (x: { sec: number; paused?: boolean } | null) => void; onClearTask: () => void }) {
  const { t } = useT();
  const [min, setMin] = useState(1);
  const [sec, setSec] = useState(0);
  const num = (v: string, max: number) => Math.max(0, Math.min(max, Number(v.replace(/\D/g, "")) || 0));
  const set = left > 0; // таймер уже идёт или стоит на паузе
  const total = min * 60 + sec;
  const add = (d: number) => { if (set) onSet({ sec: left + d, paused }); else { const v = Math.min(99 * 60, total + d); setMin(Math.floor(v / 60)); setSec(v % 60); } };
  return (
    <div className="ctimer">
      <h3 className="mb-2">{t("cls.timer")}</h3>
      {task && <div className="ctimer-task"><Icon name="clock" size="sm" /><span className="grow truncate">{t("cls.timerFor", { task })}</span><button type="button" className="iconbtn" aria-label={t("common.cancel")} onClick={onClearTask}><Icon name="close" size="sm" /></button></div>}
      <div className={`ctimer-big ${set ? "on" : ""}`} aria-live="polite">
        {set ? <span>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span> : (
          <>
            <input inputMode="numeric" value={String(min).padStart(2, "0")} onChange={(e) => setMin(num(e.target.value.slice(-2), 99))} aria-label={t("cls.tMin")} />
            <span>:</span>
            <input inputMode="numeric" value={String(sec).padStart(2, "0")} onChange={(e) => setSec(num(e.target.value.slice(-2), 59))} aria-label={t("cls.tSec")} />
          </>
        )}
      </div>
      {!set && <div className="ctimer-presets">{[1, 2, 3, 5, 10, 15].map((m) => <button key={m} type="button" className={`pchip ${total === m * 60 ? "on" : ""}`} onClick={() => { setMin(m); setSec(0); }}>{m} {t("dash.min")}</button>)}</div>}
      <div className="ctimer-add">
        <button type="button" className="btn secondary sm" onClick={() => add(15)}>+15 {t("cls.tSecShort")}</button>
        <button type="button" className="btn secondary sm" onClick={() => add(60)}>+1 {t("dash.min")}</button>
        {!set && total > 0 && <button type="button" className="btn plain sm" onClick={() => { setMin(0); setSec(0); }}>{t("cls.tZero")}</button>}
      </div>
      {!set ? (
        <button className="btn primary w-full mt-3" disabled={total <= 0} onClick={() => onSet({ sec: total })}>{t("cls.tStart")}</button>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {paused ? <button className="btn primary" onClick={() => onSet({ sec: left })}>{t("cls.tResume")}</button> : <button className="btn secondary" onClick={() => onSet({ sec: left, paused: true })}>{t("cls.tPause")}</button>}
          <button className="btn secondary" onClick={() => onSet(null)}>{t("cls.tReset")}</button>
        </div>
      )}
      <p className="hint mt-3 mb-0">{task ? t("cls.timerTaskHint") : t("cls.timerHint")}</p>
    </div>
  );
}

/** Заметки урока ученика: пишут и ученик, и учитель, сохраняется на ходу и сразу видно у другого. */
function SharedNotes({ value, onChange, who, hint, all, onPick, flash, point }: { value: string; onChange: (v: string) => Promise<unknown>; who: React.ReactNode; hint: string; all?: { sid: string; name: string; text: string }[]; onPick?: (sid: string) => void; flash?: boolean; point?: { label: string; go: () => void } }) {
  const [sent, setSent] = useState(false);
  const { t } = useT();
  const [v, setV] = useState(value);
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const typedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // пришло с другой стороны — показываем сразу, если сами не печатаем прямо сейчас
  useEffect(() => {
    if (Date.now() - typedAt.current > 1500) { setV(value); return; }
    const h = setTimeout(() => setV(value), 1600 - (Date.now() - typedAt.current));
    return () => clearTimeout(h);
  }, [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const change = (x: string) => {
    typedAt.current = Date.now();
    setV(x); setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void onChange(x).then(() => setState("saved")); }, 500);
  };
  return (
    <div id="cls-snote" className={`cls-snote mt-4 ${flash ? "cls-flash" : ""}`}>
      <div className="flex items-center justify-between gap-2"><b className="small">{t("cls.snote")}</b>
        <span className="flex items-center gap-1.5"><span className="small muted">{state === "saving" ? "…" : state === "saved" ? "✓" : ""}</span>
          {point && <button type="button" className={`iconbtn ${sent ? "bd-on" : ""}`} title={point.label} aria-label={point.label} onClick={() => { point.go(); setSent(true); setTimeout(() => setSent(false), 1500); }}><Icon name="pointer" size="sm" /></button>}</span></div>
      {who}
      {all ? (
        <div className="snall">
          {all.map((x) => (
            <button key={x.sid} type="button" className="snall-item" title={t("cls.snoteEdit")} onClick={() => onPick?.(x.sid)}>
              <b>{x.name}</b><span className={x.text.trim() ? "" : "muted"}>{x.text.trim() || t("cls.snoteEmpty")}</span>
            </button>
          ))}
        </div>
      ) : (
        <textarea className="textarea" rows={5} value={v} placeholder={t("cls.snotePh")} aria-label={t("cls.snote")}
          onChange={(e) => change(e.target.value)} />
      )}
      <span className="small muted">{hint}</span>
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

function ClassDialogs({ which, close, d, hwComment, send, onFinished, onCheer }: { which: string | null; close: () => void; d: ClassData; hwComment: string | null; send: (type: string, x?: Record<string, unknown>) => Promise<{ ok: boolean }>; onFinished: () => void; onCheer: () => void }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [fbTo, setFbTo] = useState<string | null>(null);
  useEffect(() => { setText(which === "hwc" ? hwComment ?? "" : ""); setDone(false); setFbTo(null); }, [which, hwComment]);
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
  if (which === "pick") return <LessonPicker d={d} send={send} close={close} />;
  if (which === "finish")
    return (
      <Dialog open onClose={close} title={t("cls.finishQ")}>
        <p className="muted mt-0">{t("cls.finishHint")}</p>
        <button type="button" className="chrnudge" onClick={onCheer}><span aria-hidden="true">💛</span><span className="grow"><b>{t("chr.btn")}</b><br /><span className="small muted">{t("chr.nudge")}</span></span><Icon name="right" size="sm" /></button>
        <div className="actions"><button className="btn secondary" onClick={close}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await send("finish"); setBusy(false); close(); onFinished(); }}>{t("cls.finish")}</button></div>
      </Dialog>
    );
  const isHw = which === "hwc";
  const members = d.group?.members ?? [];
  return (
    <Dialog open onClose={close} title={isHw ? t("cls.hwComment") : t("cls.feedback")}>
      {done ? <p className="alert ok">✓ {isHw ? t("common.saved") : t("cls.fbSent")}{!isHw && fbTo ? ` — ${members.find((m) => m.sid === fbTo)?.name ?? ""}` : ""}</p> : (
        <>
          {/* групповой урок: кому фидбэк */}
          {!isHw && members.length > 0 && (
            <div className="field mb-3"><span className="flabel">{t("grp.fbTo")}</span>
              <div className="flex flex-wrap gap-1.5">{members.map((m) => <button key={m.sid} type="button" className={`pchip ${fbTo === m.sid ? "on" : ""}`} aria-pressed={fbTo === m.sid} onClick={() => setFbTo(m.sid)}>{m.name}</button>)}</div>
            </div>
          )}
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={isHw ? t("cls.hwCommentPh") : t("cls.feedbackPh")} autoFocus aria-label={isHw ? t("cls.hwComment") : t("cls.feedback")} />
          <p className="hint">{isHw ? t("cls.hwCommentHint") : t("cls.feedbackHint")}</p>
          <div className="actions"><button className="btn secondary" onClick={close}>{t("common.cancel")}</button>
            <button className="btn primary" disabled={busy || (!isHw && (!text.trim() || (members.length > 0 && !fbTo)))} onClick={async () => { setBusy(true); await send(isHw ? "hwComment" : "feedback", fbTo && !isHw ? { text, studentId: fbTo } : { text }); setBusy(false); setDone(true); }}>{isHw ? t("common.save") : t("cls.send")}</button></div>
        </>
      )}
    </Dialog>
  );
}

/** Ученики группы у инструментов задания: имя, мини-дорожка (зелёное — верно, красное — ошибка, серое — ещё нет). */
function StudentChips({ task, members, ansBy, sel, online, onPick }: { task: CTask; members: NonNullable<ClassData["group"]>["members"]; ansBy: Record<string, Answers>; sel: string | null; online: string[]; onPick: (sid: string) => void }) {
  const { t } = useT();
  const rows = members.map((m) => ({ m, steps: progressOf(task, ansBy[m.sid]?.[task.id] as Record<string, unknown> | undefined) }));
  if (rows.every((r) => r.steps === null)) return null; // у задания нет ответов (текст, картинка…)
  return (
    <span className="schips" role="group" aria-label={t("grp.answersOf")}>
      {rows.map(({ m, steps }) => {
        const st = summary(steps ?? []);
        return (
          <button key={m.sid} type="button" className={`schip ${sel === m.sid ? "on" : ""}`} aria-pressed={sel === m.sid} onClick={() => onPick(m.sid)}
            title={`${m.name}${m.userId && online.includes(m.userId) ? ` · ${t("grp.inClass")}` : ""}: ${t("grp.trackTip", { ok: st.ok, bad: st.bad, total: st.total })}${sel === m.sid ? ` · ${t("grp.unpick")}` : ` · ${t("grp.pickHint")}`}`}>
            <span className="schip-n">{m.name.split(" ")[0]}{st.done && st.bad === 0 && isFinal(task, ansBy[m.sid]?.[task.id] as Record<string, unknown> | undefined) ? " ✓" : ""}</span>
            <span className="schip-bar">{(steps ?? []).map((x: Step, i) => <i key={i} className={x} />)}</span>
          </button>
        );
      })}
    </span>
  );
}

