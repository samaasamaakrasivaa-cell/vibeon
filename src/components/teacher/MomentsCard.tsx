"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { addStudentEvent, closeStudentEvent, hideMoment } from "@/lib/teacher/moment-actions";
import type { Moment } from "@/lib/teacher/moments";
import { StudentAvatar } from "../awards/Medal";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";

const EMOJI: Record<Moment["kind"], string> = { birthday: "🎂", lessons: "🎯", together: "💛", active: "🚀", streak: "🔥", event: "📌" };

/** Подпись события: имя — что случилось; вторая строка — подсказка, что сделать. */
export function useMomentText() {
  const { t } = useT();
  const fmtMin = (m: number) => (m >= 60 ? t("mo.hm", { h: Math.floor(m / 60), m: m % 60 }) : t("mo.m", { m }));
  return (m: Moment) => {
    const soon = m.days > 0, past = m.days < 0;
    switch (m.kind) {
      case "birthday": return { what: m.days === 0 ? t("mo.bdToday") : past ? t("mo.bdPast") : m.n ? t("mo.bdAge", { n: m.n }) : t("mo.bd"), hint: past ? t("mo.bdPastHint") : t("mo.bdHint") };
      case "lessons": return { what: soon ? t("mo.lessonsSoon", { n: m.n ?? 0 }) : t("mo.lessons", { n: m.n ?? 0 }), hint: t("mo.giveHint") };
      case "together": return { what: (soon ? t("mo.soon") + " " : "") + (m.give?.name ?? t("mo.year")).toLowerCase(), hint: t("mo.giveHint") };
      case "active": return { what: t("mo.active", { t: fmtMin(m.n ?? 0) }) + (m.n2 ? ` · ${t("mo.activeLesson", { t: fmtMin(m.n2) })}` : ""), hint: t("mo.giveHint") };
      case "streak": return { what: t("mo.streak", { n: m.n ?? 0 }), hint: t("mo.giveHint") };
      default: return { what: m.text ?? "", hint: t("mo.eventHint") };
    }
  };
}

export function whenLabel(t: ReturnType<typeof useT>["t"], days: number) {
  return days === 0 ? t("mo.today") : days === 1 ? t("bd.tomorrow") : days > 1 ? t("bd.inDays", { n: days }) : days === -1 ? t("mo.yesterday") : t("mo.daysAgo", { n: -days });
}

/** Кнопка «Выдать награду» → анкета ученика, окно выдачи уже с нужным статусом. */
export function GiveLink({ m, small }: { m: Moment; small?: boolean }) {
  const { t } = useT();
  if (!m.give) return null;
  if (m.given) return <span className="pill green">✓ {t("mo.given")}</span>;
  const q = new URLSearchParams({ give: m.give.key, ...(m.give.name ? { gn: m.give.name } : {}) });
  return <Link href={`/teacher/students/${m.studentId}?${q}#awards`} className={`btn ${small ? "plain" : "secondary"} sm`}>{m.kind === "birthday" ? "🎁 " + t("mo.congrats") : "🏅 " + t("mo.give")}</Link>;
}

/** Главная учителя → «События учеников»: дни рождения, вехи, активность, свои события; «+ Своё событие». */
export function MomentsCard({ moments, students }: { moments: Moment[]; students: { id: string; name: string }[] }) {
  const { t, lang } = useT();
  const router = useRouter();
  const text = useMomentText();
  const [add, setAdd] = useState(false);
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  const close = async (id: string, remove = false) => { await closeStudentEvent(id, remove); router.refresh(); };
  return (
    <section className="card" id="moments">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="m-0 grow">{t("mo.title")}</h2>
        <button type="button" className="btn secondary sm" onClick={() => setAdd(true)}><Icon name="plus" size="sm" />{t("mo.add")}</button>
      </div>
      <p className="small muted mt-0 mb-3">{t("mo.sub")}</p>
      {moments.length === 0 ? <p className="hint m-0">{t("mo.none")}</p> : (
        <ul className="molist">
          {moments.map((m) => {
            const x = text(m);
            return (
              <li key={m.id} className={`mo-${m.kind} ${m.days === 0 ? "now" : ""}`}>
                <Link href={`/teacher/students/${m.studentId}`} className="mo-av"><StudentAvatar id={m.studentId} avatar={m.avatar} size={40} /><span className="mo-emoji" aria-hidden="true">{EMOJI[m.kind]}</span></Link>
                <div className="grow min-w-0">
                  <div><Link href={`/teacher/students/${m.studentId}`} className="mo-name">{m.name}</Link> — {x.what}</div>
                  <span className="small muted">{x.hint}</span>
                </div>
                <span className={`pill ${m.days === 0 ? "orange" : m.days > 0 && m.days <= 3 ? "violet" : "grey"}`} title={new Date(`${m.day}T12:00:00Z`).toLocaleDateString(loc, { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" })}>{whenLabel(t, m.days)}</span>
                <div className="mo-act">
                  {m.kind === "event" && m.eventId ? (
                    <>
                      <button type="button" className="btn plain sm" onClick={() => close(m.eventId!)}>✓ {t("mo.done")}</button>
                      <button type="button" className="iconbtn" aria-label={t("common.delete")} title={t("common.delete")} onClick={() => confirm(t("mo.delQ")) && close(m.eventId!, true)}><Icon name="close" size="sm" /></button>
                    </>
                  ) : <>
                    <GiveLink m={m} />
                    {/* неактуально — закрыть; после выдачи награды событие уходит само */}
                    <button type="button" className="iconbtn" aria-label={t("mo.hide")} title={t("mo.hide")} onClick={async () => { await hideMoment(m.id); router.refresh(); }}><Icon name="close" size="sm" /></button>
                  </>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {add && <AddEvent students={students} onClose={() => setAdd(false)} />}
    </section>
  );
}

function AddEvent({ students, onClose }: { students: { id: string; name: string }[]; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [sid, setSid] = useState(students.length === 1 ? students[0].id : "");
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <Dialog open onClose={onClose} title={t("mo.addTitle")}>
      <p className="muted mt-0">{t("mo.addHint")}</p>
      <div className="field"><label htmlFor="ev-s">{t("mo.student")}</label>
        <select id="ev-s" className="select" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">—</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="field mt-3"><label htmlFor="ev-d">{t("mo.date")}</label><input id="ev-d" className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
      <div className="field mt-3"><label htmlFor="ev-t">{t("mo.what")}</label><textarea id="ev-t" className="textarea" rows={3} maxLength={300} value={text} placeholder={t("mo.whatPh")} onChange={(e) => setText(e.target.value)} /></div>
      {err && <div className="alert mt-2">{t("adm.err.fail")}</div>}
      <div className="actions"><button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn primary" disabled={busy || !sid || !day || !text.trim()} onClick={async () => { setBusy(true); const r = await addStudentEvent(sid, day, text); setBusy(false); if (!r.ok) return setErr(true); onClose(); router.refresh(); }}>{t("common.save")}</button></div>
    </Dialog>
  );
}
