"use client";
import { useRef, useState } from "react";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { TaskCard, type TaskData } from "../tasks/TaskView";
import { upload } from "../courses/CourseView";
import { useT } from "@/lib/i18n/client";
import { HELP, HOWTO, PRESET, TYPES, type TaskOptions, type TaskType } from "@/lib/tasks/catalog";
import { thumbSvg } from "@/lib/tasks/thumbs";
import { fileToTask, helpTask } from "@/lib/ai/actions";
import { extractFile } from "../ai/BookImport";

const CONTENT_TYPES: TaskType[] = ["gap", "drag", "dropdown", "test", "tf", "pairs", "columns", "picture", "sentence", "textorder", "letters", "essay", "open", "record", "speak", "errors", "transform", "translate", "dictation", "crossword", "wordset", "vocab", "text", "note"];
/** Где в содержании работает оформление (жирный, курсив, цвет, маркер): тексты, вопросы, утверждения, строки с пропусками. */
const FMT_TYPES: TaskType[] = ["text", "note", "vocab", "speak", "open", "essay", "record", "gap", "drag", "dropdown", "test", "tf"];
const FMT_COLORS = ["blue", "red", "green", "purple", "orange"] as const;
const CHECK_TYPES = (t: TaskType) => !!TYPES[t].checkable;

export function TaskEditor({ lessonId, initial, onSave, onClose, pending, error }: {
  lessonId: string; initial: TaskData; onSave: (t: TaskData) => void; onClose: () => void; pending: boolean; error: string | null;
}) {
  const { t, lang } = useT();
  const L = (x?: [string, string]) => (x ? (lang === "en" ? x[0] : x[1]) : "");
  const [task, setTask] = useState<TaskData>(initial);
  const o = task.options;
  const setO = (p: Partial<TaskOptions>) => setTask((x) => ({ ...x, options: { ...x.options, ...p } }));
  const [own, setOwn] = useState(!PRESET[task.type]?.includes(task.title));
  const ta = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [ai, setAi] = useState<"help" | "file" | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const type = task.type;
  const isGap = type === "gap" || type === "drag";

  /** Панель разметки: [ ] — пропуск, ✓ — верный вариант, 1. — нумерация строк. */
  // оформление выделенного текста: **жирный**, *курсив*, __подчёркнутый__, ==маркер==, {blue}цвет{/}
  const fmt = (open: string, close = open) => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const sel = value.slice(a, b) || "text";
    const next = value.slice(0, a) + open + sel + close + value.slice(b);
    setTask((x) => ({ ...x, content: next }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + open.length, a + open.length + sel.length); });
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
    <Dialog open onClose={onClose} wide>
      <div className="ted">
        <div className="ted-l">
          <div className="mb-4 flex items-center gap-3">
            <span className="ted-thumb" dangerouslySetInnerHTML={{ __html: thumbSvg(type) }} />
            <h2>{lang === "en" ? TYPES[type].en : TYPES[type].ru}</h2>
          </div>

          {type !== "divider" && (
            <div className="field">
              <span className="flabel">{t("bld.instruction")}</span>
              {own || !PRESET[type]?.length ? (
                <input className="input" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder={PRESET[type]?.[0]} autoFocus />
              ) : (
                <div className="input font-semibold">{task.title}</div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {PRESET[type]?.filter(Boolean).map((p) => (
                  <button key={p} type="button" className={`pchip ${task.title === p && !own ? "on" : ""}`} onClick={() => { setOwn(false); setTask({ ...task, title: p }); }}>{p}</button>
                ))}
                <button type="button" className="pchip add" onClick={() => setOwn(true)}>+ {t("bld.ownInstruction")}</button>
              </div>
            </div>
          )}

          {CONTENT_TYPES.includes(type) && (
            <div className="field mt-4">
              <span className="flabel">{t("bld.content")}</span>
              <div className="tedbox">
                <textarea ref={ta} className="tedta" value={task.content} onChange={(e) => setTask({ ...task, content: e.target.value })} spellCheck={false} aria-label={t("bld.content")} />
                <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
                  {(isGap || type === "dropdown" || type === "errors") && <button type="button" className="pchip" onClick={() => wrap("gap")} title={t("bld.mkGap")}>[ ]</button>}
                  {(type === "dropdown" || type === "test" || type === "errors") && <button type="button" className="pchip" onClick={() => wrap("star")} title={t("bld.mkRight")}>✓</button>}
                  <button type="button" className="pchip" onClick={() => wrap("num")} title={t("bld.mkNum")}>1.</button>
                  {FMT_TYPES.includes(type) && (
                    <span className="tedfmt" role="group" aria-label={t("bld.fmt")}>
                      <button type="button" className="pchip" onClick={() => fmt("**")} title={t("bld.fmtB")}><b>B</b></button>
                      <button type="button" className="pchip" onClick={() => fmt("*")} title={t("bld.fmtI")}><i>I</i></button>
                      <button type="button" className="pchip" onClick={() => fmt("__")} title={t("bld.fmtU")}><u>U</u></button>
                      <button type="button" className="pchip" onClick={() => fmt("==")} title={t("bld.fmtMark")}><mark className="tk-mark">ab</mark></button>
                      {FMT_COLORS.map((c) => <button key={c} type="button" className="pchip tedcol" onClick={() => fmt(`{${c}}`, "{/}")} title={t("bld.fmtColor")} aria-label={`${t("bld.fmtColor")}: ${c}`}><span className={`tk-c-${c}`}>A</span></button>)}
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
          {(type === "image" || type === "text") && (
            <div className="field mt-4">
              <span className="flabel">{type === "image" ? t("bld.images") : t("bld.textPic")}</span>
              <div className="flex flex-col gap-2">
                {(o.images ?? []).map((im, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <img src={im.src} alt="" className="h-12 w-16 rounded-lg object-cover" />
                    <input className="input" value={im.caption ?? ""} placeholder={t("bld.caption")} onChange={(e) => setO({ images: (o.images ?? []).map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)) })} />
                    <button type="button" className="iconbtn" aria-label={t("common.delete")} onClick={() => setO({ images: (o.images ?? []).filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
                <label className="upl">
                  <Icon name="plus" />{uploading ? t("bld.uploading") : type === "image" ? t("bld.uploadImages") : t("bld.uploadImage")}
                  <input type="file" accept="image/*" multiple={type === "image"} hidden onChange={(e) => doUpload(e.target.files, (urls) => setO({ images: [...(type === "image" ? o.images ?? [] : []), ...urls.map((src) => ({ src }))] }))} />
                </label>
                {type === "image" && (o.images?.length ?? 0) > 1 && (
                  <div className="seg self-start">
                    <button type="button" aria-pressed={o.layout !== "stack"} onClick={() => setO({ layout: undefined })}>{t("bld.carousel")}</button>
                    <button type="button" aria-pressed={o.layout === "stack"} onClick={() => setO({ layout: "stack" })}>{t("bld.stack")}</button>
                  </div>
                )}
              </div>
            </div>
          )}
          {(type === "video" || type === "audio") && (
            <div className="field mt-4">
              <label htmlFor="te-src" className="flabel">{type === "video" ? t("bld.videoLink") : t("bld.audioLink")}</label>
              <input id="te-src" className="input" value={o.src ?? ""} onChange={(e) => setO({ src: e.target.value })} placeholder={type === "video" ? "https://youtu.be/… · rutube.ru/video/… · vk.com/video…" : "https://…/audio.mp3"} />
              <label className="upl">
                <Icon name="plus" />{uploading ? t("bld.uploading") : t("bld.orFile")}
                <input type="file" accept={type === "video" ? "video/*" : "audio/*"} hidden onChange={(e) => doUpload(e.target.files, (u) => setO({ src: u[0] }))} />
              </label>
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
                {type === "essay" && <div className="setting"><span>{t("bld.wordLimit")}</span><input className="input" style={{ width: 90 }} inputMode="numeric" value={o.limitWords ?? ""} placeholder="150" onChange={(e) => setO({ limitWords: Number(e.target.value.replace(/\D/g, "")) || undefined })} /></div>}
                {type === "letters" && <div className="setting"><span>{t("bld.timer")}</span><input className="input" style={{ width: 90 }} inputMode="numeric" value={o.limitSec ?? ""} placeholder="—" onChange={(e) => setO({ limitSec: Number(e.target.value.replace(/\D/g, "")) || undefined })} /></div>}
                {(type === "video" || type === "audio") && <label className="setting"><span>{t("bld.showScript")}</span><span className="switch"><input type="checkbox" checked={!!o.showScript} onChange={(e) => setO({ showScript: e.target.checked })} /><span /></span></label>}
                {type === "speak" && (
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
          <div className="ted-prev"><TaskCard task={task} index={0} /></div>
        </div>
      </div>
      {error && <div className="alert mt-3">{error}</div>}
      <div className="actions">
        <button className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button className="btn primary" disabled={pending || uploading} onClick={() => onSave(task)}>{t("bld.saveTask")}</button>
      </div>
    </Dialog>
  );
}
