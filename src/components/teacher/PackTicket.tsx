"use client";
import { useState } from "react";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { packDeduct, packFreeze } from "@/lib/teacher/actions";
import { useRun } from "../courses/useRun";

export type PackInfo = { left: number; total: number; since?: string; ends?: string | null; used?: string[]; frozen?: string | null }; // used — даты списанных уроков; frozen — заморожен до

/** Абонемент карточкой-«билетом»: сколько занятий из скольких осталось (кружки), когда куплен, когда примерно закончится
 *  по расписанию; «Списать занятие» — вручную по дате (например, абонемент оформили позже урока). */
export function PackTicket({ studentId, pack, today, compact = false }: { studentId: string; pack: PackInfo; today: string; compact?: boolean }) {
  const { t } = useT();
  const { pending, error, run } = useRun();
  const [ask, setAsk] = useState<{ date: string; start: string } | null>(null);
  const [freeze, setFreeze] = useState<string | null>(null);
  const used = pack.total - pack.left;
  return (
    <div className={`pticket ${compact ? "sm" : ""} ${pack.left === 0 ? "empty" : pack.left <= 1 ? "low" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <small className="pt-k">{t("pt.title", { n: pack.total })}</small>
          <b className="pt-big">{t("pt.left", { n: pack.left, total: pack.total })}</b>
        </div>
        {pack.frozen ? <span className="pt-auto">❄︎ {t("pt.frozenUntil", { d: pack.frozen })}</span> : <span className="pt-auto" title={t("pt.autoHint")}><Icon name="check" size="sm" />{t("pt.auto")}</span>}
      </div>
      <div className="pt-dots" aria-label={t("pt.left", { n: pack.left, total: pack.total })}>
        {Array.from({ length: pack.total }, (_, i) => <i key={i} className={i < used ? "used" : ""} />)}
      </div>
      {!!pack.used?.length && <div className="pt-used">{t("pt.usedOn", { d: pack.used.join(" · ") })}</div>}
      <div className="pt-dates">
        {pack.since && <span>{t("pt.bought", { d: pack.since })}</span>}
        <span>{pack.left === 0 ? t("pt.over") : pack.ends ? t("pt.ends", { d: pack.ends }) : t("pt.endsUnknown")}</span>
      </div>
      {/* обычно не нужно: проведённые по расписанию уроки списываются сами; вручную — если урока не было в расписании */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {pack.left > 0 && <button type="button" className="pt-manual" disabled={pending} onClick={() => setAsk({ date: today, start: "" })}>{t("pt.deductManual")}</button>}
        {!compact && (pack.frozen ? <button type="button" className="pt-manual" disabled={pending} onClick={() => run(() => packFreeze(studentId, null))}>{t("pt.unfreeze")}</button>
          : pack.left > 0 && <button type="button" className="pt-manual" disabled={pending} onClick={() => setFreeze(today)}>{t("pt.freeze")}</button>)}
      </div>
      <Dialog open={freeze !== null} onClose={() => setFreeze(null)} title={t("pt.freeze")}>
        {freeze !== null && (
          <>
            <div className="field"><label htmlFor={`pf-${studentId}`}>{t("pt.freezeUntil")}</label><input id={`pf-${studentId}`} type="date" className="input" value={freeze} min={today} onChange={(e) => setFreeze(e.target.value)} /></div>
            <p className="hint mt-3 mb-0">{t("pt.freezeHint")}</p>
            {error && <div className="alert mt-2">{error}</div>}
            <div className="actions">
              <button className="btn secondary" onClick={() => setFreeze(null)}>{t("common.cancel")}</button>
              <button className="btn primary" disabled={pending || !freeze} onClick={() => run(() => packFreeze(studentId, freeze), () => setFreeze(null))}>{t("pt.freezeBtn")}</button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog open={!!ask} onClose={() => setAsk(null)} title={t("prof.packDeduct")}>
        {ask && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="field"><label htmlFor={`pt-d-${studentId}`}>{t("prof.packDeductDate")}</label><input id={`pt-d-${studentId}`} type="date" className="input" value={ask.date} max={today} onChange={(e) => setAsk({ ...ask, date: e.target.value })} /></div>
              <div className="field"><label htmlFor={`pt-t-${studentId}`}>{t("prof.packDeductTime")}</label><input id={`pt-t-${studentId}`} type="time" className="input" value={ask.start} onChange={(e) => setAsk({ ...ask, start: e.target.value })} /></div>
            </div>
            <p className="hint mt-3 mb-0">{t("prof.packDeductHint")}</p>
            {error && <div className="alert mt-2">{error}</div>}
            <div className="actions">
              <button className="btn secondary" onClick={() => setAsk(null)}>{t("common.cancel")}</button>
              <button className="btn primary" disabled={pending || !ask.date} onClick={() => run(() => packDeduct(studentId, ask.date, ask.start), () => setAsk(null))}>{t("prof.packDeductBtn")}</button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
