"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import {
  createLesson, deleteLesson, makeWeekly, moveLesson, saveLessonNote, setLessonStatus, type Result,
} from "@/lib/teacher/actions";

export type GridLesson = {
  id: string; day: number; startMin: number; dur: number; status: "PLANNED" | "DONE" | "MISSED" | "CANCELLED";
  who: string; isTrial: boolean; isGroup: boolean; note: string | null; date: string; start: string; end: string;
  weekly: boolean; past: boolean; studentId: string | null; charged: boolean; moved: boolean; price: number;
};
export type GridStudent = { id: string; name: string; initials: string };
type Day = { iso: string; dow: string; num: number; today: boolean; past: boolean; earned: string | null };

const PX = 44; // высота часа, px

export function WeekGrid(props: {
  days: Day[]; lessons: GridLesson[]; hourFrom: number; hourTo: number; nowDay: number; nowMin: number; todayIso: string;
  students: GridStudent[]; weekTotal: string; legend: boolean; preset?: { studentId?: string; trial?: boolean };
}) {
  const { t } = useT();
  const { days, hourFrom, hourTo } = props;
  const [over, setOver] = useState<Record<string, { status: GridLesson["status"]; charged: boolean }>>({});
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; setOver((o) => ({ ...o, [d.id]: { status: d.status, charged: d.charged } })); };
    window.addEventListener("vibeon-status", h);
    return () => window.removeEventListener("vibeon-status", h);
  }, []);
  // когда сервер прислал тот же статус — наложение больше не нужно
  useEffect(() => { setOver((o) => Object.fromEntries(Object.entries(o).filter(([id, v]) => props.lessons.find((l) => l.id === id)?.status !== v.status))); }, [props.lessons]);
  const lessons = props.lessons.map((l) => (over[l.id] ? { ...l, ...over[l.id] } : l));
  const [newAt, setNewAt] = useState<{ date: string; start: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = lessons.find((l) => l.id === openId) ?? null;

  // ?new=1 из «Пригласить → Поставить пробный урок»
  useEffect(() => {
    if (props.preset) setNewAt(nextSlot(props.todayIso, props.nowMin));
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
  const pickTime = (e: React.MouseEvent<HTMLDivElement>, day: Day) => {
    if ((e.target as HTMLElement).closest(".lesson")) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const min = Math.max(0, Math.round(((y / PX) * 60) / 30) * 30) + hourFrom * 60;
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
            <div key={d.iso} className={`daycol ${d.past ? "past" : ""}`} style={{ height }} onClick={(e) => pickTime(e, d)} title={t("sch.clickToAdd")}>
              {hours.slice(1).map((h) => <div key={h} className="hl" style={{ top: (h - hourFrom) * PX }} />)}
              {props.nowDay === di && props.nowMin >= hourFrom * 60 && props.nowMin <= hourTo * 60 && (
                <div className="nowline" style={{ top: ((props.nowMin - hourFrom * 60) / 60) * PX }} />
              )}
              {lessons.filter((l) => l.day === di).map((l) => {
                const cls = l.isTrial ? "trial" : l.status === "PLANNED" ? "" : l.status.toLowerCase();
                const h = Math.max(22, (l.dur / 60) * PX - 3);
                return (
                  <button
                    key={l.id} data-lesson={l.id} type="button" className={`lesson ${cls}`}
                    style={{ top: ((l.startMin - hourFrom * 60) / 60) * PX + 1.5, height: h }}
                    onClick={() => setOpenId(l.id)}
                    title={`${l.start}–${l.end} · ${l.who}${l.note ? "\n" + l.note : ""}`}
                  >
                    <span className="nm">
                      <span className={`sdot ${cls}`} />
                      {l.isGroup && <Icon name="group" size="sm" />}
                      {l.who.split(" ")[0]}
                    </span>
                    {h > 34 && <span className="tm">{l.start}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="earned" style={{ textAlign: "left", fontSize: 11 }}>{t("sch.earned")}</div>
          {days.map((d) => <div key={d.iso} className={`earned ${d.earned ? "has" : ""}`}>{d.earned ?? "—"}</div>)}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="legend">
          <span><i style={{ background: "var(--accent)" }} />{t("sch.st.planned")}</span>
          <span><i style={{ background: "var(--ok)" }} />{t("sch.st.done")}</span>
          <span><i style={{ background: "var(--warn)" }} />{t("sch.st.cancelled")}</span>
          <span><i style={{ background: "var(--bad)" }} />{t("sch.st.missed")}</span>
          <span><i style={{ background: "var(--violet)" }} />{t("sch.trial")}</span>
        </div>
        <Link href="/teacher/finance" className="inline-flex items-center gap-1 text-[14px] font-semibold text-accent">
          {t("sch.weekTotal")}: {props.weekTotal} <Icon name="right" size="sm" />
        </Link>
      </div>

      {newAt && (
        <NewLessonDialog now={{ iso: props.todayIso, min: props.nowMin }} at={newAt} students={props.students} preset={props.preset} onClose={() => setNewAt(null)} />
      )}
      {open && <LessonDialog l={open} onClose={() => setOpenId(null)} />}
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

function NewLessonDialog({ at, students, preset, onClose, now }: { at: { date: string; start: string }; students: GridStudent[]; preset?: { studentId?: string; trial?: boolean }; onClose: () => void; now: { iso: string; min: number } }) {
  const { t } = useT();
  const { pending, error, run } = useRun();
  const [studentId, setStudentId] = useState<string | null>(preset?.studentId ?? null);
  const [trial, setTrial] = useState(!!preset?.trial);
  const [trialName, setTrialName] = useState("");
  const [date, setDate] = useState(at.date);
  const [start, setStart] = useState(at.start);
  const [dur, setDur] = useState(60);
  const [repeat, setRepeat] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => students.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())), [students, q]);
  const needName = trial && !studentId;
  // прошло ли выбранное время — по часам учителя
  const [hh, mm] = (start || "00:00").split(":").map(Number);
  const inPast = date < now.iso || (date === now.iso && hh * 60 + mm < now.min);
  return (
    <Dialog open onClose={onClose} title={t("sch.new")}>
      <div className="flex flex-col gap-4">
        <div className="field">
          <span className="flabel">{t("sch.who")}</span>
          {students.length > 5 && <input className="input" placeholder={t("sch.search")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
          {students.length === 0 ? (
            <p className="hint m-0">{t("sch.noStudents")}</p>
          ) : (
            <div className="pick">
              {list.map((s) => (
                <button key={s.id} type="button" aria-pressed={studentId === s.id} onClick={() => setStudentId(studentId === s.id ? null : s.id)}>
                  <span className="avatar">{s.initials}</span>{s.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="setting">
          <span>{t("sch.trial")}</span>
          <span className="switch"><input type="checkbox" checked={trial} onChange={(e) => { setTrial(e.target.checked); if (e.target.checked) setRepeat(false); }} /><span /></span>
        </label>
        {needName && (
          <div className="field">
            <label htmlFor="tn">{t("sch.trialName")}</label>
            <input id="tn" className="input" value={trialName} onChange={(e) => setTrialName(e.target.value)} placeholder={t("auth.namePh") === "Elvira" ? "Olga" : "Ольга"} />
          </div>
        )}
        {trial && <p className="hint -mt-2 m-0">{t("sch.trialHint")}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="field"><label htmlFor="nd">{t("sch.date")}</label><input id="nd" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="ns">{t("sch.start")}</label><input id="ns" type="time" step={300} className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        </div>
        {inPast && <div className="alert -mt-1 m-0" role="alert">{t("sch.pastWarn")}</div>}
        <div className="field">
          <span className="flabel">{t("sch.length")}</span>
          <div className="seg">
            {[45, 60, 90, 120].map((m) => (
              <button key={m} type="button" aria-pressed={dur === m} onClick={() => setDur(m)}>{m} {t("dash.min")}</button>
            ))}
          </div>
        </div>
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
          type="button" className="btn primary" disabled={pending}
          onClick={() => run(() => createLesson({ studentId, isTrial: trial, trialName, date, start, durationMin: dur, repeat }), onClose)}
        >
          {t("sch.add")}
        </button>
      </div>
    </Dialog>
  );
}

function LessonDialog({ l, onClose }: { l: GridLesson; onClose: () => void }) {
  const { t } = useT();
  const { pending, error, run } = useRun();
  const [mode, setMode] = useState<"main" | "move" | "miss" | "cancel" | "del">("main");
  const [fix, setFix] = useState(false); // исправление ошибки — не считать переносом
  // Новый статус показываем сразу после успешного действия, не дожидаясь обновления страницы
  const setStatus = (status: GridLesson["status"], charged?: boolean, close = false) =>
    run(() => setLessonStatus(l.id, status, charged), () => {
      window.dispatchEvent(new CustomEvent("vibeon-status", { detail: { id: l.id, status, charged: charged ?? status === "DONE" } }));
      if (close) onClose();
    });
  const [note, setNote] = useState(l.note ?? "");
  const [saved, setSaved] = useState(false);
  const [date, setDate] = useState(l.date);
  const [start, setStart] = useState(l.start);
  const head = (
    <div className="mb-4">
      <h2 className="pr-10">{l.who}</h2>
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
      <div className="flex flex-wrap items-center gap-2">
        <span className={`pill ${statusPill[l.status][0]}`}>{t(statusPill[l.status][1])}</span>
        {l.status === "MISSED" && <span className="pill grey">{l.charged ? t("sch.charged") : t("sch.notCharged")}</span>}
        {l.moved && <span className="pill violet">{t("sch.moved")}</span>}
        <span className="pill grey" title={t("common.soon", { n: 5 })}>{t("today.noHw")}</span>
      </div>
      <div className="field mt-4">
        <label htmlFor="ln">{t("sch.note")}</label>
        <textarea id="ln" className="textarea" value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} placeholder={t("sch.notePh")} />
        <div className="flex items-center gap-3">
          <button className="btn secondary sm" disabled={pending} onClick={() => run(() => saveLessonNote(l.id, note), () => setSaved(true))}>{t("sch.saveNote")}</button>
          {saved && <span className="small text-ok">✓ {t("common.saved")}</span>}
        </div>
        <span className="hint">{t("sch.noteHint")}</span>
      </div>
      {!l.weekly && !l.isTrial && !l.past && (
        <div className="setting mt-2">
          <span className="muted">{t("sch.oneOff")}</span>
          <button className="btn plain sm" disabled={pending} onClick={() => run(() => makeWeekly(l.id))}>{t("sch.makeWeekly")}</button>
        </div>
      )}
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
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <div className="flex flex-wrap gap-2">
          {(l.status === "PLANNED" || l.past) && <button className="btn secondary sm" onClick={() => { setFix(l.past); setMode("move"); }}><Icon name="move" size="sm" />{l.past ? t("sch.editTime") : t("sch.move")}</button>}
          {!l.past && l.status === "PLANNED" && <button className="btn secondary sm" onClick={() => setMode("cancel")}><Icon name="calx" size="sm" />{t("sch.cancelLesson")}</button>}
          <button className="btn danger sm" onClick={() => setMode("del")}>{t("common.delete")}</button>
        </div>
        <Link href={`/class/${l.id}`} className="btn primary sm"><Icon name="class" size="sm" />{t("dash.openClass")}</Link>
      </div>
      {l.studentId && <Link href={`/teacher/students/${l.studentId}`} className="alink mt-3 inline-block text-[14px]">{t("sch.openProfile")}</Link>}
    </Dialog>
  );
}
