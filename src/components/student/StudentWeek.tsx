"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { requestLesson } from "@/lib/student/actions";

export type SLesson = { id: string; day: number; startMin: number; dur: number; title: string; status: string; start: string; end: string; date: string; moved: boolean; past: boolean };
type Day = { iso: string; dow: string; num: number; today: boolean; past: boolean; long: string };
const PX = 44;

export function StudentWeek({ days, lessons, hourFrom, hourTo, nowDay, nowMin, title, nav }: { days: Day[]; lessons: SLesson[]; hourFrom: number; hourTo: number; nowDay: number; nowMin: number; title: string; nav: React.ReactNode }) {
  const { t } = useT();
  const [req, setReq] = useState<string | null>(null);
  const [open, setOpen] = useState<SLesson | null>(null);
  const hours = Array.from({ length: hourTo - hourFrom + 1 }, (_, i) => hourFrom + i);
  const height = (hourTo - hourFrom) * PX;
  const pick = (e: React.MouseEvent<HTMLDivElement>, d: Day) => {
    if ((e.target as HTMLElement).closest(".lesson") || d.past) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const min = Math.round(((y / PX) * 60) / 30) * 30 + hourFrom * 60;
    setReq(t("sts.reqText", { day: d.long, time: `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}` }));
  };
  return (
    <>
      <div className="mb-4 mt-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">{nav}<button className="btn primary" onClick={() => setReq(t("sts.reqTextAny"))}><Icon name="plus" size="sm" />{t("sts.extra")}</button></div>
      </div>
      <section className="card" style={{ padding: "20px 20px 18px" }}>
        <div className="weekwrap">
          <div className="week">
            <div />
            {days.map((d) => <div key={d.iso} className={`dh ${d.today ? "today" : ""}`}><span>{d.dow}<b>{d.num}</b></span></div>)}
            <div className="hours" style={{ height }}>{hours.map((h) => <div key={h} style={{ top: (h - hourFrom) * PX }}>{String(h).padStart(2, "0")}:00</div>)}</div>
            {days.map((d, di) => (
              <div key={d.iso} className={`daycol ${d.past ? "past" : ""}`} style={{ height, cursor: d.past ? "default" : "cell" }} onClick={(e) => pick(e, d)} title={d.past ? undefined : t("sts.clickFree")}>
                {hours.slice(1).map((h) => <div key={h} className="hl" style={{ top: (h - hourFrom) * PX }} />)}
                {nowDay === di && <div className="nowline" style={{ top: ((nowMin - hourFrom * 60) / 60) * PX }} />}
                {lessons.filter((l) => l.day === di).map((l) => {
                  const cls = l.status === "PLANNED" ? "" : l.status.toLowerCase();
                  return (
                    <button key={l.id} type="button" className={`lesson ${cls}`} style={{ top: ((l.startMin - hourFrom * 60) / 60) * PX + 1.5, height: Math.max(22, (l.dur / 60) * PX - 3) }} onClick={() => setOpen(l)} title={`${l.start}–${l.end}${l.moved ? " · " + t("sch.moved") : ""}`}>
                      <span className="nm">{l.title}</span>{l.dur >= 40 && <span className="tm">{l.start}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="legend mt-4">
          <span><i style={{ background: "var(--accent)" }} />{t("sts.upcoming")}</span>
          <span><i style={{ background: "var(--ok)" }} />{t("sch.st.done")}</span>
          <span><i style={{ background: "var(--warn)" }} />{t("sch.st.cancelled")}</span>
        </div>
      </section>
      {req !== null && <RequestDialog text={req} onClose={() => setReq(null)} />}
      {open && (
        <Dialog open onClose={() => setOpen(null)} title={open.title}>
          <p className="muted mt-0">{open.date}, {open.start}–{open.end}{open.moved ? ` · ${t("sch.moved")}` : ""}</p>
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <Link className="btn primary" href={`/class/${open.id}${open.past ? "?tab=homework" : ""}`}><Icon name="class" size="sm" />{open.past ? t("sts.openLesson") : t("cls.enter")}</Link>
            {!open.past && <button className="btn secondary" onClick={() => { const l = open; setOpen(null); setReq(t("sts.moveText", { date: l.date, time: l.start })); }}>{t("sts.askMove")}</button>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function RequestDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const { t } = useT();
  const [v, setV] = useState(text);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open onClose={onClose} title={t("sts.reqTitle")}>
      {sent ? <p className="alert ok">✓ {t("sts.reqSent")}</p> : (
        <>
          <p className="muted mt-0">{t("sts.reqLead")}</p>
          <textarea className="textarea" value={v} onChange={(e) => setV(e.target.value)} aria-label={t("sts.reqTitle")} />
          <div className="actions"><button className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
            <button className="btn primary" disabled={pending || !v.trim()} onClick={() => start(async () => { const r = await requestLesson(v); if (r.ok) setSent(true); })}>{t("cls.send")}</button></div>
        </>
      )}
    </Dialog>
  );
}
