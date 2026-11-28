"use client";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Dialog } from "../Dialog";
import { confirmLessonPaid, undoLessonPaid } from "@/lib/billing/actions";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { scheduleRangeMinutes } from "@/lib/teacher/schedule-range";
import {
  createLesson, createTimeOff, deleteLesson, deleteTimeOff, makeWeekly, moveLesson, saveLessonNote, setCallLink, setLessonPrice, setLessonStatus, updateTimeOff, type Result,
} from "@/lib/teacher/actions";

export type GridLesson = {
  id: string; day: number; startMin: number; dur: number; status: "PLANNED" | "DONE" | "MISSED" | "CANCELLED";
  who: string; isTrial: boolean; isGroup: boolean; note: string | null; date: string; start: string; end: string;
  weekly: boolean; past: boolean; studentId: string | null; charged: boolean; moved: boolean; price: number;
  group?: { id: string; members: string[] } | null; // групповое занятие: состав
  hw: "review" | "partial" | "notdone" | "checked" | null;
  analysisLessonId?: string;
  prices?: { id: string; name: string; price: number; locked: boolean; counts: boolean; pay?: { state: "paid" | "billed" | "pack" | "unpaid"; invId: string | null; quick: boolean } | null }[]; // цена и оплата урока; у группового — по ученикам
  callLink?: string | null; // ссылка на созвон (одна на ученика / группу)
  short?: string; // имя в сетке: «Анна», а если Ань несколько — «Анна К.»
};
export type GridStudent = { id: string; name: string; initials: string };
/** Нерабочее время учителя (выходной, свои дела): закрашенный блок в сетке. */
export type GridOff = { id: string; day: number; date: string; startMin: number; endMin: number; start: string; end: string; weekly: boolean; note: string | null };
type TimeRange = { start: string; end: string };
type LessonTime = { date: string; start: string; end?: string };
type OffDraft = TimeRange & { id?: string; date: string; weekly: boolean; note: string };
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
type Day = { iso: string; dow: string; num: number; today: boolean; past: boolean; earned: string | null; tip?: string };

const PX = 44; // высота часа, px

export function WeekGrid(props: {
  days: Day[]; lessons: GridLesson[]; offs?: GridOff[]; hourFrom: number; hourTo: number; nowDay: number; nowMin: number; todayIso: string;
  students: GridStudent[]; groups?: GridStudent[]; weekTotal: string; legend: boolean; preset?: { studentId?: string; groupId?: string; trial?: boolean; date?: string };
}) {
  const { t, lang } = useT();
  const { days, hourFrom, hourTo } = props;
  const [over, setOver] = useState<Record<string, { status: GridLesson["status"]; charged: boolean }>>({});
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; setOver((o) => ({ ...o, [d.id]: { status: d.status, charged: d.charged } })); };
    window.addEventListener("vibeon-status", h);
    return () => window.removeEventListener("vibeon-status", h);
  }, []);
  // когда сервер прислал тот же статус — наложение больше не нужно
  useEffect(() => {
    const statuses = new Map(props.lessons.map((lesson) => [lesson.id, lesson.status]));
    setOver((over) => Object.fromEntries(Object.entries(over).filter(([id, value]) => statuses.has(id) && statuses.get(id) !== value.status)));
  }, [props.lessons]);
  const lessons = props.lessons.map((l) => (over[l.id] ? { ...l, ...over[l.id] } : l));
  const cancelled = lessons.filter((l) => l.status === "CANCELLED");
  const [newAt, setNewAt] = useState<LessonTime | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = lessons.find((l) => l.id === openId) ?? null;

  // ?new=1 из «Пригласить → Поставить пробный урок»
  useEffect(() => {
    // «Добавить урок» с главной на конкретный день — этот день, 18:00; иначе ближайшее время
    if (props.preset) setNewAt(props.preset.date && props.preset.date > props.todayIso ? { date: props.preset.date, start: "18:00" } : nextSlot(props.todayIso, props.nowMin));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // На узком экране сетка листается вбок — сразу показываем сегодняшний день
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = wrap.current;
    const col = w?.querySelectorAll<HTMLElement>(".daycol")[Math.max(0, props.nowDay)];
    const hrs = w?.querySelector<HTMLElement>(".hours");
    if (w && col && hrs && w.scrollWidth > w.clientWidth && props.nowDay > 0)
      w.scrollLeft = col.getBoundingClientRect().left - w.getBoundingClientRect().left + w.scrollLeft - hrs.offsetWidth - 4;
  }, [props.nowDay]);

  const hours = Array.from({ length: hourTo - hourFrom + 1 }, (_, i) => hourFrom + i);
  const height = (hourTo - hourFrom) * PX;
  const offs = props.offs ?? [];
  const [off, setOff] = useState<OffDraft | null>(null); // окно «Нерабочее время»
  // выделение мышью: нажали на пустом месте и протянули — «Отметить как нерабочее время» или урок в это время
  const [sel, setSel] = useState<{ day: number; a: number; b: number } | null>(null);
  const [picked, setPicked] = useState<(TimeRange & { day: Day }) | null>(null);
  const pickedInvalid = picked !== null && scheduleRangeMinutes(picked.start, picked.end) === null;
  const drag = useRef<{ day: number; y0: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const snap = (y: number) => Math.max(hourFrom * 60, Math.min(hourTo * 60, hourFrom * 60 + Math.round(((y / PX) * 60) / 15) * 15));
  const selection = (y0: number, y: number) => {
    const a = Math.min(snap(Math.min(y0, y)), hourTo * 60 - 15);
    return { a, b: Math.max(snap(Math.max(y0, y)), a + 15) };
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>, di: number) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || (e.target as HTMLElement).closest(".lesson, .offblk")) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    drag.current = { day: di, y0: y, moved: false };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    if (!d.moved && Math.abs(y - d.y0) < 8) return;
    if (!d.moved) { d.moved = true; e.currentTarget.setPointerCapture(e.pointerId); }
    setSel({ day: d.day, ...selection(d.y0, y) });
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    justDragged.current = true; // клик после протягивания — не «новый урок»
    setTimeout(() => { justDragged.current = false; }, 0);
    const { a, b } = selection(d.y0, e.clientY - e.currentTarget.getBoundingClientRect().top);
    setPicked({ day: days[d.day], start: hm(a), end: hm(b) });
    setSel(null);
  };
  // перетаскивание урока мышью: зажали урок и тянем на другое время или день — тень показывает новое место;
  // отпустили — окно «Перенести» с подставленной датой и временем (одно нажатие — и готово)
  const [ghost, setGhost] = useState<{ id: string; day: number; min: number; dur: number } | null>(null);
  const [moveTo, setMoveTo] = useState<{ date: string; start: string } | null>(null);
  const lDrag = useRef<{ id: string; x0: number; y0: number; grab: number; dur: number; moved: boolean } | null>(null);
  const targetOf = (x: number, y: number, grab: number, dur: number) => {
    const cols = [...(wrap.current?.querySelectorAll<HTMLElement>(".daycol") ?? [])];
    const di = cols.findIndex((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right; });
    if (di < 0) return null;
    const r = cols[di].getBoundingClientRect();
    const raw = hourFrom * 60 + ((y - r.top) / PX) * 60 - grab;
    const min = Math.max(hourFrom * 60, Math.min(hourTo * 60 - Math.min(dur, 60), Math.round(raw / 15) * 15));
    return { day: di, min };
  };
  const onLessonDown = (e: React.PointerEvent<HTMLButtonElement>, l: GridLesson) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || l.status !== "PLANNED") return;
    const r = e.currentTarget.getBoundingClientRect();
    lDrag.current = { id: l.id, x0: e.clientX, y0: e.clientY, grab: ((e.clientY - r.top) / PX) * 60, dur: l.dur, moved: false };
    const move = (ev: PointerEvent) => {
      const d = lDrag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 6) return;
      d.moved = true;
      document.body.classList.add("lmoving");
      const tg = targetOf(ev.clientX, ev.clientY, d.grab, d.dur);
      setGhost(tg ? { id: d.id, ...tg, dur: d.dur } : null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      document.body.classList.remove("lmoving");
      const d = lDrag.current;
      lDrag.current = null;
      setGhost(null);
      if (!d?.moved) return;
      justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 0);
      const tg = targetOf(ev.clientX, ev.clientY, d.grab, d.dur);
      const l0 = lessons.find((x) => x.id === d.id);
      if (!tg || !l0 || (tg.day === l0.day && tg.min === l0.startMin)) return;
      setMoveTo({ date: days[tg.day].iso, start: hm(tg.min) });
      setOpenId(d.id);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const pickTime = (e: React.MouseEvent<HTMLDivElement>, day: Day) => {
    if (justDragged.current) return;
    if ((e.target as HTMLElement).closest(".lesson, .offblk")) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const min = Math.max(0, Math.floor(y / PX) * 60) + hourFrom * 60; // нажали между 18 и 19 — урок в 18:00
    const h = Math.min(23, Math.floor(min / 60));
    setNewAt({ date: day.iso, start: `${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}` });
  };

  return (
    <>
      <div className="weekwrap" ref={wrap}>
        <div className="week">
          <div />
          {days.map((d) => (
            <div key={d.iso} className={`dh ${d.today ? "today" : ""}`}><span>{d.dow}<b>{d.num}</b></span></div>
          ))}
          <div className="hours" style={{ height }}>
            {hours.map((h) => (
              <div key={h} style={{ top: (h - hourFrom) * PX }}>{String(h).padStart(2, "0")}:00</div>
            ))}
          </div>
          {days.map((d, di) => (
            <div key={d.iso} className={`daycol ${d.past ? "past" : ""}`} style={{ height }} onClick={(e) => pickTime(e, d)} title={`${t("sch.clickToAdd")}\n${t("off.dragHint")}`}
              onPointerDown={(e) => onDown(e, di)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setSel(null); }}>
              {hours.slice(1).map((h) => <div key={h} className="hl" style={{ top: (h - hourFrom) * PX }} />)}
              {/* нерабочее время — под уроками, закрашено штриховкой */}
              {offs.filter((o) => o.day === di && o.endMin > hourFrom * 60 && o.startMin < hourTo * 60).map((o) => {
                const a = Math.max(o.startMin, hourFrom * 60), b = Math.min(o.endMin, hourTo * 60);
                return (
                  <button key={o.id} type="button" data-off={o.id} className="offblk" style={{ top: ((a - hourFrom * 60) / 60) * PX, height: Math.max(14, ((b - a) / 60) * PX) }}
                    title={`${t("off.title")} ${o.start}–${o.end}${o.note ? ` · ${o.note}` : ""}`}
                    onClick={(e) => { e.stopPropagation(); setOff({ id: o.id, date: o.date, start: o.start, end: o.end, weekly: o.weekly, note: o.note ?? "" }); }}>
                    {(b - a) >= 40 && <span className="offblk-t">{o.weekly && <span aria-hidden="true">↻</span>}{o.note || t("off.label")}</span>}
                    {(b - a) >= 70 && <small>{o.start}–{o.end}</small>}
                  </button>
                );
              })}
              {/* тень перетаскиваемого урока — новое время */}
              {ghost?.day === di && <div className="lghost" style={{ top: ((ghost.min - hourFrom * 60) / 60) * PX + 1.5, height: Math.max(22, (ghost.dur / 60) * PX - 3) }}><span>{hm(ghost.min)}–{hm(ghost.min + ghost.dur)}</span></div>}
              {sel?.day === di && <div className="selblk" style={{ top: ((sel.a - hourFrom * 60) / 60) * PX, height: ((sel.b - sel.a) / 60) * PX }}><span>{hm(sel.a)}–{hm(sel.b)}</span></div>}
              {props.nowDay === di && props.nowMin >= hourFrom * 60 && props.nowMin <= hourTo * 60 && (
                <div className="nowline" style={{ top: ((props.nowMin - hourFrom * 60) / 60) * PX }} />
              )}
              {lessons.filter((l) => l.day === di && l.status !== "CANCELLED").map((l) => {
                const cls = l.isTrial ? "trial" : l.status === "PLANNED" ? "" : l.status.toLowerCase();
                const h = Math.max(22, (l.dur / 60) * PX - 3);
                return (
                  <button
                    key={l.id} data-lesson={l.id} type="button" className={`lesson ${cls} ${ghost?.id === l.id ? "lsrc" : ""}`}
                    style={{ top: ((l.startMin - hourFrom * 60) / 60) * PX + 1.5, height: h }}
                    onClick={() => { if (justDragged.current) return; setMoveTo(null); setOpenId(l.id); }}
                    onPointerDown={(e) => onLessonDown(e, l)}
                    title={`${l.start}–${l.end} · ${l.who}${l.note ? "\n" + l.note : ""}${l.status === "PLANNED" ? `\n${t("sch.dragHint")}` : ""}`}
                  >
                    <span className="nm">
                      <span className={`sdot ${cls}`} />
                      {l.isGroup && <Icon name="group" size="sm" />}
                      {l.short ?? l.who.split(" ")[0]}
                    </span>
                    {h > 34 && <span className="tm">{l.start}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="earned earned-lbl" title={t("sch.earned")}>{t("sch.earnedShort")}</div>
          {days.map((d) => <div key={d.iso} className={`earned ${d.earned ? "has" : ""}`} title={d.tip || undefined}>{d.earned ?? "—"}</div>)}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="legend">
          <span><i style={{ background: "var(--accent)" }} />{t("sch.st.planned")}</span>
          <span><i style={{ background: "var(--ok)" }} />{t("sch.st.done")}</span>
          <span><i style={{ background: "var(--bad)" }} />{t("sch.st.missed")}</span>
          <span><i style={{ background: "var(--violet)" }} />{t("sch.trial")}</span>
        </div>
        <Link href="/teacher/finance" className="inline-flex items-center gap-1 text-[14px] font-semibold text-accent">
          {t("sch.weekTotal")}: {props.weekTotal} <Icon name="right" size="sm" />
        </Link>
      </div>

      {cancelled.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-text2">{t("sch.cancelledHistory")} ({cancelled.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {cancelled.map((lesson) => (
              <li key={lesson.id}>
                <button type="button" className="btn secondary sm flex-wrap" onClick={() => { setMoveTo(null); setOpenId(lesson.id); }}>
                  <span>{lesson.date.split("-").reverse().join(".")} · {lesson.start}–{lesson.end}</span>
                  <b>{lesson.who}</b>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {newAt && (
        <NewLessonDialog now={{ iso: props.todayIso, min: props.nowMin }} at={newAt} students={props.students} groups={props.groups ?? []} preset={props.preset} offs={offs} onClose={() => setNewAt(null)} />
      )}
      {picked && (
        <Dialog open onClose={() => setPicked(null)} title={
          <time dateTime={picked.day.iso} className="inline-block border-b-2 border-[var(--accent)] pb-1 text-[clamp(1rem,4.5vw,1.4rem)] font-bold tracking-tight">
            {new Date(`${picked.day.iso}T12:00:00Z`).toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
          </time>
        }>
          <div className="flex flex-col gap-4">
            <div className="mx-auto w-full max-w-xs">
              <TimeRangeFields range={picked} onChange={(range) => setPicked({ day: picked.day, ...range })} />
            </div>
            {pickedInvalid && <p className="alert m-0" role="alert">{t("off.err")}</p>}
            <div className="flex flex-col gap-2">
              <button type="button" className="btn primary w-full" disabled={pickedInvalid} onClick={() => { setNewAt({ date: picked.day.iso, start: picked.start, end: picked.end }); setPicked(null); }}><Icon name="plus" size="sm" />{t("off.newLesson")}</button>
              <button type="button" className="btn secondary w-full" disabled={pickedInvalid} onClick={() => { setOff({ date: picked.day.iso, start: picked.start, end: picked.end, weekly: false, note: "" }); setPicked(null); }}>
                <Icon name="lockI" size="sm" />
                <span className="min-w-0 whitespace-normal text-center">{t("off.mark")}</span>
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {off && <TimeOffDialog x={off} onClose={() => setOff(null)} />}
      {open && <LessonDialog l={open} onClose={() => { setOpenId(null); setMoveTo(null); }} initial={moveTo ? "move" : "main"} moveTo={moveTo} />}
    </>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn().catch(() => ({ ok: false as const, error: "Error" }));
      if (!r.ok) return setError(r.error);
      // Обновление страницы — после завершения действия, вне этой операции (внутри неё два обновления
      // иногда блокировали друг друга). Само действие тоже обновляет страницу через revalidatePath.
      setTimeout(() => router.refresh(), 0);
      after?.();
    });
  return { pending, error, run };
}

/** Ближайшее разумное время для нового урока по часам учителя (его пояс): сегодня 18:00, ближайший час до 21:00 или завтра 18:00. */
function nextSlot(todayIso: string, nowMin: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(nowMin / 60);
  if (h < 17) return { date: todayIso, start: "18:00" };
  if (h < 21) return { date: todayIso, start: `${pad(h + 1)}:00` };
  const d = new Date(`${todayIso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  return { date: d.toISOString().slice(0, 10), start: "18:00" };
}

/** Выбор ученика: выпадающий список; если учеников больше 5 — поиск по имени сверху. */
export function StudentPicker({ students, value, onChange, placeholder }: { students: GridStudent[]; value: string | null; onChange: (id: string | null) => void; placeholder?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const cur = students.find((s) => s.id === value);
  const list = useMemo(() => students.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())), [students, q]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="spick" ref={box}>
      <button type="button" className="input spick-btn" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(!open)}>
        {cur ? <><span className="avatar">{cur.initials}</span><span className="grow truncate text-left">{cur.name}</span></> : <span className="grow text-left text-text3">{placeholder ?? t("sch.pickStudent")}</span>}
        <Icon name="chevd" size="sm" />
      </button>
      {open && (
        <div className="spick-pop" role="listbox">
          {students.length > 5 && <input className="input" placeholder={t("sch.search")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && list[0]) { e.preventDefault(); onChange(list[0].id); setOpen(false); } }} />}
          <div className="spick-list">
            {value && <button type="button" className="spick-none" onClick={() => { onChange(null); setOpen(false); }}>{t("sch.noOne")}</button>}
            {list.map((s) => (
              <button key={s.id} type="button" role="option" aria-selected={value === s.id} onClick={() => { onChange(s.id); setOpen(false); setQ(""); }}>
                <span className="avatar">{s.initials}</span><span className="grow truncate text-left">{s.name}</span>{value === s.id && <Icon name="check" size="sm" />}
              </button>
            ))}
            {list.length === 0 && <p className="hint m-0 p-2">{t("sch.nothingFound")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeRangeFields({ range, onChange }: { range: TimeRange; onChange: (range: TimeRange) => void }) {
  const { t } = useT();
  const id = useId();
  return (
    <div className="grid gap-2 min-[380px]:grid-cols-2">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <label htmlFor={`${id}-start`} className="flabel">{t("off.from")}</label>
        <input id={`${id}-start`} type="time" className="input min-w-0 px-2!" value={range.start} onChange={(e) => onChange({ start: e.target.value, end: range.end })} />
      </div>
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <label htmlFor={`${id}-end`} className="flabel">{t("off.to")}</label>
        <input id={`${id}-end`} type="time" className="input min-w-0 px-2!" value={range.end === "24:00" ? "00:00" : range.end} onChange={(e) => onChange({ start: range.start, end: e.target.value === "00:00" ? "24:00" : e.target.value })} />
      </div>
    </div>
  );
}

/** Нерабочее время: день, с … до, каждую неделю, что это. */
function TimeOffDialog({ x, onClose }: { x: OffDraft; onClose: () => void }) {
  const { t, lang } = useT();
  const { pending, error, run } = useRun();
  const [v, setV] = useState(x);
  const invalidTime = scheduleRangeMinutes(v.start, v.end) === null;
  const dow = new Date(`${v.date}T12:00:00Z`).toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { weekday: "long", timeZone: "UTC" });
  const save = () => run(() => (x.id ? updateTimeOff(x.id, v) : createTimeOff(v)), onClose);
  return (
    <Dialog open onClose={onClose} title={t("off.title")}>
      <div className="flex flex-col gap-4">
        <div className="field"><label htmlFor="off-d">{t("sch.date")}</label><input id="off-d" type="date" className="input" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
        <TimeRangeFields range={v} onChange={(range) => setV({ ...v, ...range })} />
        <label className="setting">
          <span><span>{t("off.weekly", { dow })}</span><br /><span className="small muted">{t("off.weeklyHint")}</span></span>
          <span className="switch"><input type="checkbox" checked={v.weekly} onChange={(e) => setV({ ...v, weekly: e.target.checked })} /><span /></span>
        </label>
        <div className="field"><label htmlFor="off-n">{t("off.note")}</label><input id="off-n" className="input" value={v.note} maxLength={120} placeholder={t("off.notePh")} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
        <p className="hint m-0">{t("off.hint")}</p>
        {(invalidTime || error) && <div className="alert" role="alert">{invalidTime ? t("off.err") : error}</div>}
      </div>
      <div className="actions">
        {x.id && <button type="button" className="btn plain bad mr-auto" disabled={pending} onClick={() => run(() => deleteTimeOff(x.id!), onClose)}>{x.weekly ? t("off.deleteSeries") : t("off.delete")}</button>}
        <button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn primary" disabled={pending || !v.date || invalidTime} onClick={save}>{t("off.save")}</button>
      </div>
    </Dialog>
  );
}

function NewLessonDialog({ at, students, groups, preset, onClose, now, offs = [] }: { at: LessonTime; students: GridStudent[]; groups: GridStudent[]; preset?: { studentId?: string; groupId?: string; trial?: boolean; date?: string }; onClose: () => void; now: { iso: string; min: number }; offs?: GridOff[] }) {
  const { t } = useT();
  const { pending, error, run } = useRun();
  const [studentId, setStudentId] = useState<string | null>(preset?.studentId ?? null);
  // кто: ученик или группа (групповое занятие — у каждого ученика группы свой урок в одном общем классе)
  const [kind, setKind] = useState<"one" | "group">(preset?.groupId ? "group" : "one");
  const [groupId, setGroupId] = useState<string | null>(preset?.groupId ?? null);
  const [trial, setTrial] = useState(!!preset?.trial);
  const [trialName, setTrialName] = useState("");
  const [date, setDate] = useState(at.date);
  const [start, setStart] = useState(at.start);
  const [end, setEnd] = useState(at.end);
  const [presetDuration, setPresetDuration] = useState(60);
  const duration = end === undefined ? presetDuration : scheduleRangeMinutes(start, end);
  const invalidTime = !date || !start || duration === null;
  const [repeat, setRepeat] = useState(false);
  const [paid, setPaid] = useState(false); // пробный урок по умолчанию бесплатный
  const [price, setPrice] = useState("");
  const needName = trial && !studentId;
  // прошло ли выбранное время — по часам учителя
  const startMin = toMin(start);
  const inPast = !invalidTime && (date < now.iso || (date === now.iso && startMin < now.min));
  // попали на нерабочее время — предупреждаем (не запрещаем)
  const clash = duration === null || invalidTime ? null : offs.find((o) => o.date === date && startMin < o.endMin && startMin + duration > o.startMin);
  const timing = { date, start, ...(end === undefined ? { durationMin: presetDuration } : { end }) };
  return (
    <Dialog open onClose={onClose} title={t("sch.new")}>
      <div className="flex flex-col gap-4">
        <div className="field">
          <span className="flabel">{t("sch.who")}</span>
          {groups.length > 0 && !trial && (
            <div className="seg mb-2 self-start">
              <button type="button" aria-pressed={kind === "one"} onClick={() => setKind("one")}>{t("grp.one")}</button>
              <button type="button" aria-pressed={kind === "group"} onClick={() => setKind("group")}><Icon name="group" size="sm" />{t("grp.group")}</button>
            </div>
          )}
          {kind === "group" && !trial
            ? <StudentPicker students={groups} value={groupId} onChange={setGroupId} placeholder={t("grp.pick")} />
            : students.length === 0 ? <p className="hint m-0">{t("sch.noStudents")}</p> : <StudentPicker students={students} value={studentId} onChange={setStudentId} />}
          {kind === "group" && !trial && groupId && <span className="hint">{t("grp.lessonHint")}</span>}
        </div>
        {kind === "one" && <label className="setting">
          <span>{t("sch.trial")}</span>
          <span className="switch"><input type="checkbox" checked={trial} onChange={(e) => { setTrial(e.target.checked); if (e.target.checked) setRepeat(false); else setPaid(false); }} /><span /></span>
        </label>}
        {needName && (
          <div className="field">
            <label htmlFor="tn">{t("sch.trialName")}</label>
            <input id="tn" className="input" value={trialName} onChange={(e) => setTrialName(e.target.value)} placeholder={t("auth.namePh") === "Elvira" ? "Olga" : "Ольга"} />
          </div>
        )}
        {trial && (
          <div className="trialbox">
            <label className="setting">
              <span>{t("sch.trialPaid")}</span>
              <span className="switch"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /><span /></span>
            </label>
            {paid && (
              <div className="field mt-2">
                <label htmlFor="tp">{t("sch.trialPrice")}</label>
                <input id="tp" className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder="1500" />
              </div>
            )}
            <p className="hint mt-2 mb-0">{paid ? t("sch.trialPaidHint") : t("sch.trialHint")}</p>
          </div>
        )}
        <div className={end === undefined ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3"}>
          <div className="field"><label htmlFor="nd">{t("sch.date")}</label><input id="nd" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {end === undefined
            ? <div className="field"><label htmlFor="ns">{t("sch.start")}</label><input id="ns" type="time" step={300} className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            : <TimeRangeFields range={{ start, end }} onChange={(range) => { setStart(range.start); setEnd(range.end); }} />}
        </div>
        {end !== undefined && duration === null && <div className="alert m-0" role="alert">{t("off.err")}</div>}
        {inPast && <div className="alert -mt-1 m-0" role="alert">{t("sch.pastWarn")}</div>}
        {clash && <div className="alert calm -mt-1 m-0" role="alert">{t("off.clash", { note: clash.note || `${clash.start}–${clash.end}` })}</div>}
        {end === undefined && <div className="field">
          <span className="flabel">{t("sch.length")}</span>
          <div className="seg">
            {[45, 60, 90, 120].map((m) => (
              <button key={m} type="button" aria-pressed={presetDuration === m} onClick={() => setPresetDuration(m)}>{m} {t("dash.min")}</button>
            ))}
          </div>
        </div>}
        {!trial && (
          <label className="setting">
            <span>{t("sch.repeat")}</span>
            <span className="switch"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /><span /></span>
          </label>
        )}
        {error && <div className="alert">{error}</div>}
      </div>
      <div className="actions">
        <button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button
          type="button" className="btn primary"
          disabled={pending || invalidTime || (kind === "group" && !trial && !groupId)}
          onClick={() => run(() => createLesson(kind === "group" && !trial ? { ...timing, groupId, isTrial: false, repeat } : { ...timing, studentId, isTrial: trial, trialName, repeat, trialPrice: trial && paid ? Number(price) || 0 : 0 }), onClose)}
        >
          {t("sch.add")}
        </button>
      </div>
    </Dialog>
  );
}

/** «Сегодня» на главной: перенести или отменить урок прямо оттуда (то же окно, что в расписании). */
export function LessonQuick({ l }: { l: GridLesson }) {
  const { t } = useT();
  const [open, setOpen] = useState<"move" | "cancel" | null>(null);
  if (l.status !== "PLANNED" || l.past) return null;
  return (
    <>
      <button type="button" className="btn plain sm" onClick={() => setOpen("move")}><Icon name="move" size="sm" />{t("sch.move")}</button>
      <button type="button" className="btn plain sm" onClick={() => setOpen("cancel")}><Icon name="calx" size="sm" />{t("sch.cancelLesson")}</button>
      {open && <LessonDialog l={l} initial={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Ссылка на созвон в карточке урока: правка сохраняется в анкету ученика (или группы) — и действует во всех его уроках. */
function CallRow({ l }: { l: GridLesson }) {
  const { t } = useT();
  const { pending, error, run } = useRun();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(l.callLink ?? "");
  return (
    <div className="lprices mt-3">
      {edit ? (
        <div className="lprice">
          <input className="input grow" inputMode="url" autoFocus value={v} placeholder="https://telemost.yandex.ru/…" aria-label={t("sch.callLink")} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run(() => setCallLink(l.id, v), () => setEdit(false)); }} />
          <button type="button" className="btn primary sm" disabled={pending} onClick={() => run(() => setCallLink(l.id, v), () => setEdit(false))}>{t("common.save")}</button>
        </div>
      ) : (
        <div className="lprice">
          {l.callLink ? <a href={l.callLink} target="_blank" rel="noreferrer" className="btn sm lcall grow"><Icon name="phone" size="sm" /><span className="truncate">{t("cls.joinCall")}</span></a> : <span className="grow muted">{t("sch.callNone")}</span>}
          <button type="button" className="iconbtn" aria-label={t("cls.linkEdit")} title={t("cls.linkEdit")} onClick={() => { setV(l.callLink ?? ""); setEdit(true); }}><Icon name="pencil" size="sm" /></button>
        </div>
      )}
      {edit && <span className="hint">{l.isGroup ? t("cls.linkHintGroup") : t("cls.linkHint")}</span>}
      {error && <div className="alert mt-2">{error}</div>}
    </div>
  );
}

/** Стоимость урока: у группового — по каждому ученику и сумма. Цену можно поправить, пока урок не оплачен. */
function Prices({ l }: { l: GridLesson }) {
  const { t, lang } = useT();
  const { pending, error, run } = useRun();
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const fmt = (n: number) => new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB").format(n).replace(/,/g, " ") + " ₽";
  const ps = l.prices ?? [];
  const total = ps.filter((p) => p.counts).reduce((a, p) => a + p.price, 0);
  return (
    <div className="lprices mt-4">
      <span className="flabel">{t("sch.price")}{ps.length > 1 && total > 0 ? ` · ${t("sch.priceTotal", { sum: fmt(total) })}` : ""}</span>
      {ps.map((p) => (
        <div key={p.id} className="lprice">
          {ps.length > 1 && <span className="grow truncate">{p.name}</span>}
          {edit === p.id ? (
            <>
              <input className="input" style={{ width: 110 }} inputMode="numeric" value={val} autoFocus aria-label={t("sch.price")} onChange={(e) => setVal(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter") run(() => setLessonPrice(p.id, Number(val)), () => setEdit(null)); }} />
              <button type="button" className="btn primary sm" disabled={pending || !val} onClick={() => run(() => setLessonPrice(p.id, Number(val)), () => setEdit(null))}>{t("common.save")}</button>
              <button type="button" className="btn plain sm" onClick={() => setEdit(null)}>{t("common.cancel")}</button>
            </>
          ) : (
            <>
              <b className={p.counts ? "" : "text-text3"}>{fmt(p.price)}</b>
              <button type="button" className="iconbtn" aria-label={t("sch.priceEdit")} title={t("sch.priceEdit")} onClick={() => { if (p.locked && !confirm(t("sch.pricePaidQ"))) return; setEdit(p.id); setVal(String(p.price || "")); }}><Icon name="pencil" size="sm" /></button>
              {/* оплата этого урока: подтвердить можно всегда, даже если счёт ещё не выставлен */}
              {p.pay && <span className="grow" />}
              {p.pay?.state === "paid" && <span className="pill green">✓ {t("lp.paid")}</span>}
              {p.pay?.state === "paid" && p.pay.quick && <button type="button" className="btn plain sm" disabled={pending} onClick={() => confirm(t("lp.undoQ")) && run(() => undoLessonPaid(p.id))}>{t("lp.undo")}</button>}
              {p.pay?.state === "pack" && <span className="pill grey">{t("lp.pack")}</span>}
              {(p.pay?.state === "billed" || p.pay?.state === "unpaid") && <>
                <span className={`pill ${p.pay.state === "billed" ? "orange" : "red"}`}>{t(p.pay.state === "billed" ? "lp.billed" : "lp.unpaid")}</span>
                <button type="button" className="btn primary sm" disabled={pending} onClick={() => {
                  let sum: number | undefined;
                  if (!p.price) { const v = Number((prompt(t("lp.askSum")) ?? "").replace(/\D/g, "")); if (!v) return; sum = v; }
                  run(() => confirmLessonPaid(p.id, sum));
                }}><Icon name="check" size="sm" />{t("lp.confirm")}</button>
              </>}
            </>
          )}
        </div>
      ))}
      {error && <div className="alert mt-2">{error}</div>}
    </div>
  );
}

function LessonDialog({ l, onClose, initial = "main", moveTo }: { l: GridLesson; onClose: () => void; initial?: "main" | "move" | "cancel"; moveTo?: { date: string; start: string } | null }) {
  const { t } = useT();
  const { pending, error, run } = useRun();
  const [mode, setMode] = useState<"main" | "move" | "miss" | "cancel" | "del">(initial);
  const [fix, setFix] = useState(false); // исправление ошибки — не считать переносом
  // Новый статус показываем сразу после успешного действия, не дожидаясь обновления страницы
  const setStatus = (status: GridLesson["status"], charged?: boolean, close = false) =>
    run(() => setLessonStatus(l.id, status, charged), () => {
      window.dispatchEvent(new CustomEvent("vibeon-status", { detail: { id: l.id, status, charged: charged ?? status === "DONE" } }));
      if (close) onClose();
    });
  const [note, setNote] = useState(l.note ?? "");
  const [saved, setSaved] = useState(false);
  const [date, setDate] = useState(moveTo?.date ?? l.date); // перетащили урок в сетке — новое место уже подставлено
  const [start, setStart] = useState(moveTo?.start ?? l.start);
  const head = (
    <div className="mb-4">
      {/* имя — ссылка на анкету (у группы — на настройки групп) */}
      {l.studentId || l.group ? (
        <h2 className="pr-10"><Link href={l.studentId ? `/teacher/students/${l.studentId}` : "/teacher/students#groups"} className="lwho" title={l.studentId ? t("sch.openProfile") : t("grp.edit")}>{l.who}<span className="lwho-go">{l.studentId ? t("sch.profileShort") : t("sch.groupShort")} →</span></Link></h2>
      ) : <h2 className="pr-10">{l.who}</h2>}
      <p className="m-0 mt-1 text-text2">{l.date.split("-").reverse().join(".")}, {l.start}–{l.end}{l.weekly ? ` · ${t("sch.everyWeek")}` : ""}{l.isTrial ? ` · ${t("sch.trial")}` : ""}</p>
    </div>
  );
  const statusPill = { PLANNED: ["blue", "sch.st.planned"], DONE: ["green", "sch.st.done"], MISSED: ["red", "sch.st.missed"], CANCELLED: ["orange", "sch.st.cancelled"] } as const;

  if (mode === "move")
    return (
      <Dialog open onClose={onClose}>
        {head}
        <h3 className="mb-3">{l.past ? t("sch.editTime") : t("sch.move")}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="field"><label htmlFor="md">{t("sch.newDate")}</label><input id="md" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="ms">{t("sch.newTime")}</label><input id="ms" type="time" step={300} className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        </div>
        <label className="setting mt-3">
          <span><b className="block text-[14px]">{t("sch.fixMistake")}</b><span className="small muted">{t("sch.fixMistakeHint")}</span></span>
          <span className="switch"><input type="checkbox" checked={fix} onChange={(e) => setFix(e.target.checked)} /><span /></span>
        </label>
        {!fix && <p className="hint mt-2 mb-0">{t("sch.moveHint")}</p>}
        {error && <div className="alert mt-3">{error}</div>}
        <div className="actions">
          <button className="btn secondary" onClick={() => setMode("main")}>{t("common.back")}</button>
          <button className="btn primary" disabled={pending} onClick={() => run(() => moveLesson(l.id, date, start, fix), onClose)}>{l.past ? t("common.save") : t("sch.move")}</button>
        </div>
      </Dialog>
    );
  if (mode === "miss")
    return (
      <Dialog open onClose={onClose}>
        {head}
        <h3 className="mb-2">{t("sch.chargeQ")}</h3>
        <p className="muted m-0">{t("sch.chargeHint")}</p>
        <div className="actions">
          <button className="btn secondary" disabled={pending} onClick={() => setStatus("MISSED", false, true)}>{t("sch.noCharge")}</button>
          <button className="btn primary" disabled={pending} onClick={() => setStatus("MISSED", true, true)}>{t("sch.charge")}</button>
        </div>
      </Dialog>
    );
  if (mode === "cancel")
    return (
      <Dialog open onClose={onClose}>
        {head}
        <h3 className="mb-2">{t("sch.cancelQ")}</h3>
        <p className="muted m-0">{t("sch.cancelHint")}</p>
        <div className="actions">
          <button className="btn secondary" onClick={() => setMode("main")}>{t("common.back")}</button>
          <button className="btn danger" disabled={pending} onClick={() => setStatus("CANCELLED", undefined, true)}>{t("sch.cancelLesson")}</button>
        </div>
      </Dialog>
    );
  if (mode === "del")
    return (
      <Dialog open onClose={onClose}>
        {head}
        <h3 className="mb-2">{t("sch.delQ")}</h3>
        <p className="muted m-0">{t("sch.delHint")}</p>
        <div className="actions">
          <button className="btn secondary" onClick={() => setMode("main")}>{t("common.back")}</button>
          {l.weekly && <button className="btn danger" disabled={pending} onClick={() => run(() => deleteLesson(l.id, "following"), onClose)}>{t("sch.delFollowing")}</button>}
          <button className="btn danger" disabled={pending} onClick={() => run(() => deleteLesson(l.id, "one"), onClose)}>{l.weekly ? t("sch.delOne") : t("common.delete")}</button>
        </div>
      </Dialog>
    );

  return (
    <Dialog open onClose={onClose}>
      {head}
      {/* порядок: войти в класс → действия с уроком → ссылка на созвон → что произошло → заметка → стоимость */}
      <Link href={`/class/${l.id}`} className="btn primary lg w-full lopen"><Icon name="class" />{t("dash.openClass")}</Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {l.status === "PLANNED" && <Link href={`/class/${l.id}?pick=1`} className="btn secondary sm"><Icon name="book" size="sm" />{t("today.changeLesson")}</Link>}
        {(l.status === "PLANNED" || l.past) && <button className="btn secondary sm" onClick={() => { setFix(l.past); setMode("move"); }}><Icon name="move" size="sm" />{l.past ? t("sch.editTime") : t("sch.move")}</button>}
        {!l.past && l.status === "PLANNED" && <button className="btn secondary sm" onClick={() => setMode("cancel")}><Icon name="calx" size="sm" />{t("sch.cancelLesson")}</button>}
        <button className="btn danger sm" onClick={() => setMode("del")}>{t("common.delete")}</button>
        {!l.weekly && !l.isTrial && !l.past && <button className="btn plain sm" disabled={pending} onClick={() => run(() => makeWeekly(l.id))}>{t("sch.makeWeekly")}</button>}
      </div>
      {l.callLink !== undefined && <CallRow l={l} />}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={`pill ${statusPill[l.status][0]}`}>{t(statusPill[l.status][1])}</span>
        {l.status === "DONE" && l.analysisLessonId && <Link href={`/teacher/lesson-analysis/${l.analysisLessonId}`} className="btn secondary sm"><Icon name="spark" size="sm" />{t("today.analysis")}</Link>}
        {l.status === "MISSED" && <span className="pill grey">{l.charged ? t("sch.charged") : t("sch.notCharged")}</span>}
        {l.moved && <span className="pill violet">{t("sch.moved")}</span>}
        {l.hw ? <Link href={`/class/${l.id}?tab=homework`} className={`pill ${{ review: "orange", partial: "blue", notdone: "red", checked: "green" }[l.hw]}`}>{t("nav.homework")}: {t(({ review: "hwT.review", partial: "hwT.partial", notdone: "hwT.notdone", checked: "hwT.checked" } as const)[l.hw])}</Link> : l.status === "DONE" && <span className="pill grey">{t("today.noHw")}</span>}
      </div>
      {l.past && l.status !== "CANCELLED" && (
        <div className="mt-3">
          <span className="flabel">{t("sch.whatHappened")}</span>
          <div className="seg mt-2">
            <button aria-pressed={l.status === "DONE"} onClick={() => setStatus("DONE")}>{t("sch.st.done")}</button>
            <button aria-pressed={l.status === "MISSED"} onClick={() => setMode("miss")}>{t("sch.st.missed")}</button>
            <button onClick={() => setMode("cancel")}>{t("sch.st.cancelled")}</button>
          </div>
        </div>
      )}
      {l.status === "CANCELLED" && (
        <button className="btn plain sm mt-3" disabled={pending} onClick={() => setStatus(l.past ? "DONE" : "PLANNED")}>{t("sch.restore")}</button>
      )}
      {error && <div className="alert mt-3">{error}</div>}
      <div className="lmore mt-4">
        <div className="field">
          <label htmlFor="ln">{t("sch.note")}</label>
          <textarea id="ln" className="textarea" rows={2} value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} placeholder={t("sch.notePh")} />
          <div className="flex items-center gap-3">
            <button className="btn secondary sm" disabled={pending} onClick={() => run(() => saveLessonNote(l.id, note), () => setSaved(true))}>{t("sch.saveNote")}</button>
            {saved && <span className="small text-ok">✓ {t("common.saved")}</span>}
            <span className="hint grow text-right">{t("sch.noteHint")}</span>
          </div>
        </div>
        {!!l.prices?.length && (!l.isTrial || l.price > 0) && <Prices l={l} />}
      </div>
      {l.group && <p className="small muted mt-3 mb-0 flex flex-wrap items-center gap-1.5"><Icon name="group" size="sm" />{l.group.members.join(", ")}</p>}
    </Dialog>
  );
}
