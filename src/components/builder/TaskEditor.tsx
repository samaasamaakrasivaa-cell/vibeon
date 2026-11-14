"use client";
import { useEffect, useRef, useState } from "react";
import { Catalog } from "./Catalog";
import { VideoClip } from "./VideoClip";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { KeyCtx, TaskCard, type TaskData } from "../tasks/TaskView";
import { upload } from "../courses/CourseView";
import { useT } from "@/lib/i18n/client";
import { HELP, HOWTO, PRESET, TYPES, type TaskOptions, type TaskType } from "@/lib/tasks/catalog";
import { thumbSvg } from "@/lib/tasks/thumbs";
import { fileToTask, helpTask } from "@/lib/ai/actions";
import { getBuilderPrefs, saveMyTitle } from "@/lib/teacher/courses";
import { extractFile } from "../ai/BookImport";

const CONTENT_TYPES: TaskType[] = ["gap", "drag", "dropdown", "test", "tf", "pairs", "columns", "picture", "sentence", "textorder", "letters", "essay", "open", "record", "speak", "errors", "mark", "transform", "translate", "dictation", "crossword", "wordset", "vocab", "info", "text", "note"];
/** Где в содержании работает оформление (жирный, курсив, цвет, маркер): тексты, вопросы, утверждения, строки с пропусками. */
const FMT_TYPES: TaskType[] = ["text", "info", "note", "vocab", "speak", "open", "essay", "record", "gap", "drag", "dropdown", "test", "tf"];
const FMT_COLORS = ["blue", "red", "green", "purple", "orange"] as const;
const CHECK_TYPES = (t: TaskType) => !!TYPES[t].checkable;
/** Смена типа: внутри одной «семьи» содержание подходит без правок и сохраняется; иначе поле очищается. */
const FAMILIES: TaskType[][] = [
  ["speak", "open", "essay", "record", "text", "note", "vocab", "dictation", "textorder", "mark"], // текст / строки
  ["gap", "drag"],
  ["letters", "crossword", "picture"],
];
const famOf = (x: TaskType) => FAMILIES.findIndex((f) => f.includes(x));
const KEEP_OPTS = ["nonum", "teacherOnly", "hidden", "help", "teacherKey"] as const;
let MY_TITLES: Record<string, string[]> | null = null; // свои формулировки: помним между открытиями редактора
/** Useful phrases — у заданий, где ученик работает с текстом, пишет или говорит (не у медиа, заметок и разделителей). */
const HELP_TYPES = (x: TaskType) => !["divider", "vocab", "info", "note", "image", "audio", "video", "link", "wordset", "picture"].includes(x);

export function TaskEditor({ lessonId, initial, onSave, onClose, pending, error }: {
  lessonId: string; initial: TaskData; onSave: (t: TaskData) => void; onClose: () => void; pending: boolean; error: string | null;
}) {
  const { t, lang } = useT();
  const L = (x?: [string, string]) => (x ? (lang === "en" ? x[0] : x[1]) : "");
  const [task, setTask] = useState<TaskData>(initial);
  const o = task.options;
  const setO = (p: Partial<TaskOptions>) => setTask((x) => ({ ...x, options: { ...x.options, ...p } }));
  const ta = useRef<HTMLTextAreaElement>(null);
  const tt = useRef<HTMLTextAreaElement>(null); // формулировка
  const lastField = useRef<"title" | "content">("content"); // B / I / цвет — к тому полю, где курсор был последним
  // свои сохранённые формулировки (кнопки-подсказки у каждого типа задания)
  const [mine, setMine] = useState<Record<string, string[]>>(MY_TITLES ?? {});
  useEffect(() => { getBuilderPrefs().then((p) => { if (p) { MY_TITLES = p.titles; setMine(p.titles); } }).catch(() => {}); }, []);
  const [keyOn, setKeyOn] = useState(!!initial.options.teacherKey);
  const [limitOn, setLimitOn] = useState(!!initial.options.limitWords);
  const [dragImg, setDragImg] = useState<number | null>(null);
  const [overImg, setOverImg] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [ai, setAi] = useState<"help" | "file" | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [retype, setRetype] = useState(false);
  const type = task.type;
  // «Сменить тип задания»: формулировка остаётся; содержание — если формат совместим; заметка, ставшая заданием, снова видна ученику
  const changeType = (to: TaskType) => {
    if (to === type) { setRetype(false); return; }
    const keep = famOf(to) >= 0 && famOf(to) === famOf(type);
    const opts: TaskOptions = Object.fromEntries(KEEP_OPTS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as TaskOptions;
    if (type === "note" && to !== "note") delete opts.teacherOnly;
    if (to === "note") opts.teacherOnly = true;
    if (to === "drag") opts.mode = "drag";
    if (!keep && task.content.trim() && !confirm(t("bld.retypeLose"))) return;
    setTask((x) => ({ ...x, type: to, content: keep ? x.content : "", options: opts }));
    setRetype(false);
  };
  const isGap = type === "gap" || type === "drag";

  /** Панель разметки: [ ] — пропуск, ✓ — верный вариант, 1. — нумерация строк. */
  // оформление выделенного текста: **жирный**, *курсив*, __подчёркнутый__, ==маркер==, {blue}цвет{/}
  const fmt = (open: string, close = open) => {
    const isTitle = lastField.current === "title" && !!tt.current;
    const el = isTitle ? tt.current : ta.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const put = (next: string, s0: number, s1: number) => {
      setTask((x) => (isTitle ? { ...x, title: next } : { ...x, content: next }));
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s0, s1); });
    };
    const sel = value.slice(a, b);
    const isColor = open.startsWith("{");
    const anyColor = /^\{\w+\}$/;
    // уже оформлено так же — повторное нажатие снимает оформление: маркеры внутри выделения…
    if (sel.length > open.length + close.length && (isColor ? anyColor.test(sel.slice(0, sel.indexOf("}") + 1)) && sel.endsWith(close) : sel.startsWith(open) && sel.endsWith(close)) && !(open === "*" && sel.startsWith("**") && !sel.startsWith("***"))) {
      const o = isColor ? sel.indexOf("}") + 1 : open.length;
      const inner = sel.slice(o, sel.length - close.length);
      const was = isColor ? sel.slice(0, o) : open;
      if (isColor && was !== open) return put(value.slice(0, a) + open + inner + close + value.slice(b), a, a + open.length + inner.length + close.length); // другой цвет — заменить
      return put(value.slice(0, a) + inner + value.slice(b), a, a + inner.length);
    }
    // …или вокруг него
    const before = value.slice(0, a), after = value.slice(b);
    const cm = isColor ? /\{\w+\}$/.exec(before) : null;
    const hasOpen = isColor ? !!cm : before.endsWith(open) && !(open === "*" && before.endsWith("**") && !before.endsWith("***"));
    if (sel && hasOpen && after.startsWith(close)) {
      const ol = isColor ? cm![0].length : open.length;
      if (isColor && cm![0] !== open) return put(before.slice(0, -ol) + open + sel + after, a - ol + open.length, a - ol + open.length + sel.length);
      return put(before.slice(0, -ol) + sel + after.slice(close.length), a - ol, a - ol + sel.length);
    }
    const txt = sel || "text";
    put(before + open + txt + close + after, a + open.length, a + open.length + txt.length);
  };
  /** «Снять оформление» с выделенного (или со всего поля, если ничего не выделено). */
  const unfmt = () => {
    const isTitle = lastField.current === "title" && !!tt.current;
    const el = isTitle ? tt.current : ta.current;
    if (!el) return;
    let { selectionStart: a, selectionEnd: b } = el;
    const value = el.value;
    if (a === b) { a = 0; b = value.length; }
    // захватываем маркеры, стоящие вплотную к выделению
    while (a > 0 && /[*_=]/.test(value[a - 1])) a--;
    while (b < value.length && /[*_=]/.test(value[b])) b++;
    const m1 = /\{\w+\}$/.exec(value.slice(0, a)); if (m1) a -= m1[0].length;
    const m2 = /^\{\/\w*\}/.exec(value.slice(b)); if (m2) b += m2[0].length;
    const plain = value.slice(a, b).replace(/\*\*|__|==|\{\/?\w*\}/g, "").replace(/(^|[\s(])\*(?=\S)/g, "$1").replace(/(\S)\*(?=[\s.,!?;:)]|$)/g, "$1");
    const next = value.slice(0, a) + plain + value.slice(b);
    setTask((x) => (isTitle ? { ...x, title: next } : { ...x, content: next }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a, a + plain.length); });
  };
  const wrap = (kind: "gap" | "star" | "num") => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    let next = value, cur = b;
    if (kind === "gap") { const sel = value.slice(a, b) || "word"; next = value.slice(0, a) + `[${sel}]` + value.slice(b); cur = a + sel.length + 2; }
    if (kind === "star") { next = value.slice(0, b) + "*" + value.slice(b); cur = b + 1; }
    if (kind === "num") {
      const s = value.lastIndexOf("\n", a - 1) + 1, e = value.indexOf("\n", b) < 0 ? value.length : value.indexOf("\n", b);
      const block = value.slice(s, e).split("\n").map((l, i) => `${i + 1}. ${l.replace(/^\s*\d+[.)]\s*/, "")}`).join("\n");
      next = value.slice(0, s) + block + value.slice(e); cur = s + block.length;
    }
    setTask((x) => ({ ...x, content: next }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(cur, cur); });
  };

  const doUpload = async (files: FileList | null, cb: (urls: string[]) => void) => {
    if (!files?.length) return;
    setUploading(true); setUpErr(null);
    try { cb((await Promise.all([...files].map(upload))).map((r) => r.url)); }
    catch (e) { setUpErr(String((e as Error).message)); }
    finally { setUploading(false); }
  };

  // «Помочь с ИИ» дописывает поле; «Из файла» — распознаёт файл и раскладывает в разметку задания
  const help = async () => {
    setAi("help"); setAiErr(null);
    const r = await helpTask(lessonId, { type: task.type, title: task.title, content: task.content }).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setAi(null);
    if (r.ok) { setUndo(task.content); setTask((x) => ({ ...x, content: r.content })); } else setAiErr(r.error);
  };
  const fromFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setAi("file"); setAiErr(null);
    try {
      const text = await extractFile(f);
      const r = await fileToTask(task.type, text);
      if (r.ok) { setUndo(task.content); setTask((x) => ({ ...x, content: x.content.trim() ? `${x.content.trimEnd()}\n${r.content}` : r.content })); } else setAiErr(r.error);
    } catch (e) { const c = String((e as Error).message); setAiErr(["limit", "tariff", "off", "fail", "type", "size"].includes(c) ? t(`ai.err.${c}` as "ai.err.fail") : c); }
    finally { setAi(null); }
  };

  const IconOpt = ({ k, icon, label }: { k: keyof TaskOptions; icon: Parameters<typeof Icon>[0]["name"]; label: string }) => (
    <button type="button" className={`optbtn ${o[k] ? "on" : ""}`} aria-pressed={!!o[k]} title={label} onClick={() => setO({ [k]: !o[k] } as Partial<TaskOptions>)}>
      <Icon name={icon} size="sm" /><span>{label}</span>
    </button>
  );

  return (
    <>
    {/* «Сменить тип задания» — тот же каталог с картинками, что при добавлении; ✓ — содержание сохранится */}
    {retype && <Catalog fav={[]} current={type} title={t("bld.retype")} hint={t("bld.retypeHint")} mark={(k) => k !== type && famOf(k) >= 0 && famOf(k) === famOf(type)} onClose={() => setRetype(false)} onPick={changeType} />}
    <Dialog open onClose={onClose} wide>
      <div className="ted">
        <div className="ted-l">
          <div className="mb-4 flex items-center gap-3">
            <span className="ted-thumb" dangerouslySetInnerHTML={{ __html: thumbSvg(type) }} />
            <h2 className="grow">{lang === "en" ? TYPES[type].en : TYPES[type].ru}</h2>
            {type !== "divider" && <button type="button" className="btn secondary sm" onClick={() => setRetype(true)} title={t("bld.retypeHint")}><Icon name="move" size="sm" />{t("bld.retype")}</button>}
          </div>

          {type !== "divider" && (
            <div className="field">
              <span className="flabel">{t("bld.instruction")}</span>
              <textarea ref={tt} className="input ted-title" rows={Math.min(8, Math.max(1, task.title.split("\n").length))} value={task.title} onFocus={() => (lastField.current = "title")} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder={type === "info" ? t("bld.infoTitlePh") : PRESET[type]?.[0]} autoFocus aria-label={t("bld.instruction")} />
              <span className="hint">{t("bld.titleHint")}</span>
              <div className="flex flex-wrap gap-1.5">
                {PRESET[type]?.filter(Boolean).map((p) => (
                  <button key={p} type="button" className={`pchip ${task.title === p ? "on" : ""}`} onClick={() => setTask({ ...task, title: p })}>{p}</button>
                ))}
                {(mine[type] ?? []).map((p) => (
                  <span key={p} className={`pchip ted-mytitle ${task.title === p ? "on" : ""}`}>
                    <button type="button" className="plain" onClick={() => setTask({ ...task, title: p })} title={p}>★ {p.length > 60 ? `${p.slice(0, 60).replace(/\n+/g, " ")}…` : p.replace(/\n+/g, " ")}</button>
                    <button type="button" className="x" aria-label={t("bld.myTitleDel")} title={t("bld.myTitleDel")} onClick={() => void saveMyTitle(type, p, true).then((r) => { if (r.ok && r.titles) { const n = { ...mine, [type]: r.titles }; MY_TITLES = n; setMine(n); } })}>✕</button>
                  </span>
                ))}
                {(() => {
                  const cur = task.title.trim();
                  const can = !!cur && !PRESET[type]?.includes(cur) && !(mine[type] ?? []).includes(cur);
                  return (
                    <button type="button" className="pchip add" disabled={!can} title={can ? t("bld.myTitleSaveHint") : t("bld.myTitleSaveNo")}
                      onClick={() => void saveMyTitle(type, cur).then((r) => { if (r.ok && r.titles) { const n = { ...mine, [type]: r.titles }; MY_TITLES = n; setMine(n); } })}>☆ {t("bld.myTitleSave")}</button>
                  );
                })()}
              </div>
            </div>
          )}

          {CONTENT_TYPES.includes(type) && (
            <div className="field mt-4">
              <span className="flabel">{t("bld.content")}</span>
              <div className="tedbox">
                <textarea ref={ta} className="tedta" value={task.content} onFocus={() => (lastField.current = "content")} onChange={(e) => setTask({ ...task, content: e.target.value })} spellCheck={false} aria-label={t("bld.content")} />
                <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
                  {(isGap || type === "dropdown" || type === "errors") && <button type="button" className="pchip" onClick={() => wrap("gap")} title={t("bld.mkGap")}>[ ]</button>}
                  {(type === "dropdown" || type === "test" || type === "errors") && <button type="button" className="pchip" onClick={() => wrap("star")} title={t("bld.mkRight")}>✓</button>}
                  <button type="button" className="pchip" onClick={() => wrap("num")} title={t("bld.mkNum")}>1.</button>
                  {FMT_TYPES.includes(type) && (
                    <span className="tedfmt" role="group" aria-label={t("bld.fmt")} onMouseDown={(e) => e.preventDefault()}>
                      <button type="button" className="pchip" onClick={() => fmt("**")} title={t("bld.fmtB")}><b>B</b></button>
                      <button type="button" className="pchip" onClick={() => fmt("*")} title={t("bld.fmtI")}><i>I</i></button>
                      <button type="button" className="pchip" onClick={() => fmt("__")} title={t("bld.fmtU")}><u>U</u></button>
                      <button type="button" className="pchip" onClick={() => fmt("==")} title={t("bld.fmtMark")}><mark className="tk-mark">ab</mark></button>
                      {FMT_COLORS.map((c) => <button key={c} type="button" className="pchip tedcol" onClick={() => fmt(`{${c}}`, "{/}")} title={t("bld.fmtColor")} aria-label={`${t("bld.fmtColor")}: ${c}`}><span className={`tk-c-${c}`}>A</span></button>)}
                      <button type="button" className="pchip" onClick={unfmt} title={t("bld.fmtClear")} aria-label={t("bld.fmtClear")}><s>T</s><sub>x</sub></button>
                    </span>
                  )}
                  <span className="grow" />
                  {undo !== null && <button type="button" className="pchip" onClick={() => { setTask((x) => ({ ...x, content: undo })); setUndo(null); }}>↶ {t("ai.undo")}</button>}
                  <label className={`pchip ${ai ? "opacity-60" : ""}`} title={t("ai.fromFileHint")}><Icon name="clip" size="sm" />{ai === "file" ? t("ai.reading") : t("bld.fromFile")}
                    <input type="file" hidden disabled={!!ai} accept=".docx,.pptx,.pdf,.txt,.md,image/png,image/jpeg,image/webp" onChange={(e) => { void fromFile(e.target.files); e.target.value = ""; }} /></label>
                  <button type="button" className="pchip ai" disabled={!!ai} onClick={help}><Icon name="spark" size="sm" />{ai === "help" ? t("ai.thinking") : t("bld.helpAi")}</button>
                </div>
              </div>
              {aiErr && <div className="alert mt-1">{aiErr}</div>}
              {HELP[type] && <span className="hint">{L(HELP[type])}</span>}
              {HOWTO[type] && <details className="how"><summary>ⓘ {t("bld.howto")}</summary>{L(HOWTO[type])}</details>}
            </div>
          )}

          {/* Материалы */}
          {(type === "image" || type === "text" || type === "textorder") && (() => {
            const imgs = o.images ?? [];
            const many = type !== "text";
            const setImgs = (n: NonNullable<TaskOptions["images"]>) => setO({ images: n });
            const move = (from: number, to: number) => { if (from === to || to < 0 || to >= imgs.length) return; const n = [...imgs]; const [v] = n.splice(from, 1); n.splice(to, 0, v); setImgs(n); };
            return (
              <div className="field mt-4">
                <span className="flabel">{type === "text" ? t("bld.textPic") : type === "textorder" ? t("bld.orderPics") : t("bld.images")}</span>
                <div className="ted-imgs">
                  {imgs.map((im, i) => (
                    // зажать и перетащить — поменять порядок; стрелки — то же для телефона
                    <div key={im.src + i} className={`ted-img ${overImg === i && dragImg !== null && dragImg !== i ? "over" : ""}`} draggable={many}
                      onDragStart={() => setDragImg(i)} onDragOver={(e) => { e.preventDefault(); setOverImg(i); }} onDragLeave={() => setOverImg(null)}
                      onDrop={() => { if (dragImg !== null) move(dragImg, i); setDragImg(null); setOverImg(null); }} onDragEnd={() => { setDragImg(null); setOverImg(null); }}>
                      {many && <span className="grip" title={t("bld.imgDrag")}><Icon name="move" size="sm" /></span>}
                      <img src={im.src} alt="" className="h-12 w-16 rounded-lg object-cover" draggable={false} />
                      <input className="input" value={im.caption ?? ""} placeholder={t("bld.caption")} onChange={(e) => setImgs(imgs.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
                      <div className="seg shrink-0" role="group" aria-label={t("bld.imgSize")} title={t("bld.imgSize")}>
                        {([["s", "S"], [undefined, "M"], ["l", "L"]] as const).map(([v, lab]) => <button key={lab} type="button" aria-pressed={im.size === v} onClick={() => setImgs(imgs.map((x, j) => (j === i ? { ...x, size: v } : x)))}>{lab}</button>)}
                      </div>
                      {many && imgs.length > 1 && <>
                        <button type="button" className="iconbtn" aria-label="up" disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                        <button type="button" className="iconbtn" aria-label="down" disabled={i === imgs.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                      </>}
                      <button type="button" className="iconbtn" aria-label={t("common.delete")} onClick={() => setImgs(imgs.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                  {many && imgs.length > 1 && <span className="hint">{t("bld.imgDragHint")}</span>}
                  <label className="upl">
                    <Icon name="plus" />{uploading ? t("bld.uploading") : many ? t("bld.uploadImages") : t("bld.uploadImage")}
                    <input type="file" accept="image/*" multiple={many} hidden onChange={(e) => doUpload(e.target.files, (urls) => setImgs([...(many ? imgs : []), ...urls.map((src) => ({ src }))]))} />
                  </label>
                  {many && imgs.length > 1 && (
                    <div className="seg self-start">
                      <button type="button" aria-pressed={o.layout !== "stack"} onClick={() => setO({ layout: undefined })}>{t("bld.carousel")}</button>
                      <button type="button" aria-pressed={o.layout === "stack"} onClick={() => setO({ layout: "stack" })}>{t("bld.stack")}</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          {(type === "video" || type === "audio") && (
            <div className="field mt-4">
              <label htmlFor="te-src" className="flabel">{type === "video" ? t("bld.videoLink") : t("bld.audioLink")}</label>
              <input id="te-src" className="input" value={o.src ?? ""} onChange={(e) => setO({ src: e.target.value })} placeholder={type === "video" ? "https://youtu.be/… · rutube.ru/video/… · vk.com/video…" : "https://…/audio.mp3"} />
              <label className="upl">
                <Icon name="plus" />{uploading ? t("bld.uploading") : t("bld.orFile")}
                <input type="file" accept={type === "video" ? "video/*" : "audio/*"} hidden onChange={(e) => doUpload(e.target.files, (u) => setO({ src: u[0] }))} />
              </label>
              {type === "video" && o.src && <VideoClip src={o.src} start={o.clipStart} end={o.clipEnd} onChange={(x) => setO(x)} />}
              <label htmlFor="te-script" className="flabel mt-2">{t("bld.script")}</label>
              <textarea id="te-script" className="textarea" value={o.script ?? ""} onChange={(e) => setO({ script: e.target.value })} />
            </div>
          )}
          {type === "link" && (
            <div className="mt-4 grid gap-3">
              <div className="field"><label htmlFor="te-url">URL</label><input id="te-url" className="input" value={o.url ?? ""} onChange={(e) => setO({ url: e.target.value })} placeholder="https://" /></div>
              <div className="field"><label htmlFor="te-lab">{t("bld.linkLabel")}</label><input id="te-lab" className="input" value={o.label ?? ""} onChange={(e) => setO({ label: e.target.value })} /></div>
            </div>
          )}
          {type === "picture" && (
            <div className="field mt-4">
              <span className="flabel">{t("bld.picPerWord")}</span>
              {task.content.split("\n").map((w) => w.trim()).filter(Boolean).map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  {o.pics?.[i] ? <img src={o.pics[i]} alt="" className="h-12 w-16 rounded-lg object-cover" /> : <span className="flex h-12 w-16 items-center justify-center rounded-lg bg-fill text-text3"><Icon name="image" size="sm" /></span>}
                  <span className="grow font-semibold">{w}</span>
                  <label className="btn secondary sm">{t("bld.choose")}<input type="file" accept="image/*" hidden onChange={(e) => doUpload(e.target.files, (u) => { const pics = [...(o.pics ?? [])]; pics[i] = u[0]; setO({ pics }); })} /></label>
                </div>
              ))}
            </div>
          )}
          {type === "text" && (
            <label className="mt-4 flex items-center gap-2"><input type="checkbox" checked={!!o.markable} onChange={(e) => setO({ markable: e.target.checked || undefined })} /><span className="small font-semibold">{t("bld.optMarkable")}</span></label>
          )}
          {type === "textorder" && (() => {
            const rows = task.content.split("\n").map((l) => l.trim()).filter(Boolean);
            const fx = new Set(o.fixed ?? []);
            if (!rows.length) return null;
            return (
              <div className="field mt-4">
                <span className="flabel">{t("bld.fixed")}</span>
                <div className="flex flex-col gap-1.5">
                  {rows.map((r, i) => (
                    <button key={i} type="button" className={`ted-pin ${fx.has(i) ? "on" : ""}`} aria-pressed={fx.has(i)}
                      onClick={() => { const n = new Set(fx); if (n.has(i)) n.delete(i); else n.add(i); setO({ fixed: n.size ? [...n].sort((a, b) => a - b) : undefined }); }}>
                      <span className="ted-pin-n">{i + 1}</span><span className="grow">{r}</span><Icon name="pin" size="sm" />
                    </button>
                  ))}
                </div>
                <span className="hint">{t("bld.fixedHint")}</span>
              </div>
            );
          })()}
          {HELP_TYPES(type) && (
            <details className="ted-help mt-4" open={!!(o.help?.vocab || o.help?.grammar)}>
              <summary><Icon name="eye" size="sm" /> {t("bld.help")}</summary>
              <span className="hint">{t("bld.helpHint")}</span>
              <label className="setting"><span className="small font-semibold">{t("bld.helpShow")}</span><span className="switch"><input type="checkbox" checked={!o.help?.hidden} onChange={(e) => setO({ help: { ...o.help, hidden: !e.target.checked || undefined } })} /><span /></span></label>
              <label className="flabel mt-2" htmlFor="te-hv">{t("bld.helpVocab")}</label>
              <textarea id="te-hv" className="textarea" rows={3} value={o.help?.vocab ?? ""} onChange={(e) => setO({ help: { ...o.help, vocab: e.target.value } })} placeholder={"to be keen on\nas far as I know"} />
              <label className="flabel mt-2" htmlFor="te-hg">{t("bld.helpGrammar")}</label>
              <textarea id="te-hg" className="textarea" rows={3} value={o.help?.grammar ?? ""} onChange={(e) => setO({ help: { ...o.help, grammar: e.target.value } })} placeholder={"I'd rather + infinitive\nIf I were you, I'd…"} />
            </details>
          )}
          {type !== "divider" && (
            <div className="ted-key mt-4">
              <label className="setting"><span className="small font-semibold"><Icon name="eyeoff" size="sm" /> {t("bld.key")}</span><span className="switch"><input type="checkbox" checked={keyOn} onChange={(e) => { setKeyOn(e.target.checked); if (!e.target.checked) setO({ teacherKey: undefined }); }} /><span /></span></label>
              {keyOn && <>
                <span className="hint">{t("bld.keyHint")}</span>
                <textarea className="textarea mt-1" rows={3} value={o.teacherKey ?? ""} onChange={(e) => setO({ teacherKey: e.target.value })} placeholder={t("bld.keyPh")} aria-label={t("bld.key")} />
              </>}
            </div>
          )}
          {upErr && <div className="alert mt-2">{t("bld.uploadErr")}: {upErr}</div>}

          {/* Опции */}
          {type !== "divider" && (
            <div className="mt-5 border-t border-sep pt-4">
              <div className="small mb-2 font-bold tracking-wide text-text3">{t("bld.options").toUpperCase()}</div>
              <div className="flex flex-wrap gap-2">
                <IconOpt k="teacherOnly" icon="eyeoff" label={t("bld.eyeOff")} />
                <IconOpt k="nonum" icon="levelI" label={t("bld.optNonum")} />
                {CHECK_TYPES(type) && <IconOpt k="noreveal" icon="lock" label={t("bld.optNoreveal")} />}
                {(TYPES[type].teacherCheck || type === "transform" || type === "translate") && <IconOpt k="check" icon="check" label={t("bld.optTeacher")} />}
                {(type === "essay" || type === "open" || type === "transform" || type === "translate") && <IconOpt k="aipre" icon="spark" label={t("bld.optAipre")} />}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {isGap && (
                  <div className="setting">
                    <span className="small font-semibold text-text2">{t("bld.student")}</span>
                    <div className="seg">
                      <button type="button" aria-pressed={!(type === "drag" || o.mode === "drag")} onClick={() => { setTask((x) => ({ ...x, type: "gap", options: { ...x.options, mode: "gap" } })); }}>{t("bld.types")}</button>
                      <button type="button" aria-pressed={type === "drag" || o.mode === "drag"} onClick={() => setO({ mode: "drag" })}>{t("bld.drags")}</button>
                    </div>
                  </div>
                )}
                {CHECK_TYPES(type) && (
                  <div className="setting">
                    <span className="small font-semibold text-text2">{t("bld.checking")}</span>
                    <div className="seg">
                      <button type="button" aria-pressed={o.checkMode === "instant"} onClick={() => setO({ checkMode: "instant" })}>{t("bld.instant")}</button>
                      <button type="button" aria-pressed={o.checkMode !== "instant"} onClick={() => setO({ checkMode: "button" })}>{t("bld.button")}</button>
                    </div>
                  </div>
                )}
                {isGap && (
                  <>
                    <label className="setting"><span>{t("bld.split")}</span><span className="switch"><input type="checkbox" checked={!!o.split} onChange={(e) => setO({ split: e.target.checked })} /><span /></span></label>
                    {o.split && <div className="setting"><span className="small muted">{t("bld.seriesSize")}</span><input className="input" style={{ width: 90 }} inputMode="numeric" value={o.seriesSize ?? 5} onChange={(e) => setO({ seriesSize: Number(e.target.value.replace(/\D/g, "")) || undefined })} /></div>}
                  </>
                )}
                {type === "tf" && <label className="setting"><span>{t("bld.ns")}</span><span className="switch"><input type="checkbox" checked={!!o.ns} onChange={(e) => setO({ ns: e.target.checked })} /><span /></span></label>}
                {type === "essay" && <label className="setting"><span>{t("bld.wordLimitOn")}</span><span className="switch"><input type="checkbox" checked={limitOn} onChange={(e) => { setLimitOn(e.target.checked); if (!e.target.checked) setO({ limitWords: undefined }); }} /><span /></span></label>}
                {type === "essay" && limitOn && <div className="setting"><span className="small muted">{t("bld.wordLimit")}</span><input className="input" style={{ width: 90 }} inputMode="numeric" value={o.limitWords ?? ""} placeholder="150" autoFocus onChange={(e) => setO({ limitWords: Number(e.target.value.replace(/\D/g, "")) || undefined })} /></div>}
                {type === "letters" && <div className="setting"><span>{t("bld.timer")}</span><input className="input" style={{ width: 90 }} inputMode="numeric" value={o.limitSec ?? ""} placeholder="—" onChange={(e) => setO({ limitSec: Number(e.target.value.replace(/\D/g, "")) || undefined })} /></div>}
                {(type === "video" || type === "audio") && <label className="setting"><span>{t("bld.showScript")}</span><span className="switch"><input type="checkbox" checked={!!o.showScript} onChange={(e) => setO({ showScript: e.target.checked })} /><span /></span></label>}
                {type === "speak" && <label className="setting"><span>{t("bld.aiTalkOn")}<br /><span className="small muted">{t("bld.aiTalkHint")}</span></span><span className="switch"><input type="checkbox" checked={!!o.aiTalk} onChange={(e) => setO({ aiTalk: e.target.checked || undefined })} /><span /></span></label>}
                {type === "speak" && o.aiTalk && (
                  <div className="flex flex-col gap-2 rounded-xl bg-fill p-3">
                    <b className="small">{t("tk.aiTalk")}</b>
                    <div className="field"><label htmlFor="te-aip" className="small muted">{t("bld.aiPrompt")}</label><input id="te-aip" className="input" value={o.aiPrompt ?? ""} placeholder={t("bld.aiPromptPh")} onChange={(e) => setO({ aiPrompt: e.target.value })} /></div>
                    <div className="field"><label htmlFor="te-aig" className="small muted">{t("ai.goal")}</label><input id="te-aig" className="input" value={o.aiGoal ?? ""} placeholder={t("bld.aiGoalPh")} onChange={(e) => setO({ aiGoal: e.target.value })} /></div>
                    <div className="field"><label htmlFor="te-aiw" className="small muted">{t("ai.useWords")}</label><input id="te-aiw" className="input" value={o.aiWords ?? ""} placeholder="outcome, worthwhile, give it a go" onChange={(e) => setO({ aiWords: e.target.value })} /></div>
                    <div className="setting"><span>{t("bld.aiMins")}</span><input className="input" style={{ width: 90 }} inputMode="numeric" value={o.aiMins ?? ""} placeholder="—" onChange={(e) => setO({ aiMins: Number(e.target.value.replace(/\D/g, "")) || undefined })} /></div>
                  </div>
                )}
                {type === "test" && <label className="setting"><span>{t("bld.multi")}</span><span className="switch"><input type="checkbox" checked={!!o.multi} onChange={(e) => setO({ multi: e.target.checked })} /><span /></span></label>}
              </div>
            </div>
          )}
        </div>

        <div className="ted-r">
          <div className="small mb-2 font-bold tracking-wide text-text3">{t("bld.studentSees").toUpperCase()}</div>
          <div className="ted-prev"><KeyCtx.Provider value={true}><TaskCard task={task} index={0} /></KeyCtx.Provider></div>
        </div>
      </div>
      {error && <div className="alert mt-3">{error}</div>}
      <div className="actions">
        <button className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button className="btn primary" disabled={pending || uploading} onClick={() => onSave(task)}>{t("bld.saveTask")}</button>
      </div>
    </Dialog>
    </>
  );
}
