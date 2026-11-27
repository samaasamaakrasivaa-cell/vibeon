"use client";
// План самостоятельной работы: что, как часто и сколько минут; ссылки — только на поиск (адреса не выдумываются).
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStudentPace } from "@/lib/roadmap/actions";
import { useT } from "@/lib/i18n/client";
import { SS_SKILLS, type SelfItem, type SelfStudy } from "@/lib/ai/route-core";
import { useRun } from "../courses/useRun";
import { Icon } from "../Icon";

const COLOR: Record<string, string> = { listening: "#0A84FF", reading: "#34C759", speaking: "#FF9500", writing: "#AF52DE", vocabulary: "#FF375F", grammar: "#5856D6" };
const link = (skill: string, q: string) => (skill === "listening" && /video|youtube|ted/i.test(q) ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : `https://www.google.com/search?q=${encodeURIComponent(q)}`);

/** Правка рекомендаций учителем: занятия строками (что, как, сколько раз, минут, что искать), советы — по строке. */
function SelfEdit({ plan, onSave, onClose }: { plan: SelfStudy; onSave: (items: SelfItem[], tips: string[]) => Promise<unknown>; onClose: () => void }) {
  const { t } = useT();
  const { run, pending, error } = useRun();
  const [items, setItems] = useState<SelfItem[]>(plan.items);
  const [tips, setTips] = useState(plan.tips.join("\n"));
  const set = (i: number, p: Partial<SelfItem>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const total = items.reduce((a, x) => a + x.times_per_week * x.minutes, 0);
  return (
    <div className="ssedit">
      {items.map((x, i) => (
        <div key={i} className="ssrow">
          <select className="select xs" value={x.skill} aria-label={t("ss.skill")} onChange={(e) => set(i, { skill: e.target.value as SelfItem["skill"] })}>{SS_SKILLS.map((k) => <option key={k} value={k}>{t(`ss.k.${k}`)}</option>)}</select>
          <input className="input xs grow" value={x.activity} placeholder={t("ss.activity")} onChange={(e) => set(i, { activity: e.target.value })} />
          <input className="input xs" style={{ width: 54 }} inputMode="numeric" value={x.times_per_week} aria-label={t("ss.times")} onChange={(e) => set(i, { times_per_week: Math.max(1, Math.min(7, Number(e.target.value.replace(/\D/g, "")) || 1)) })} /><span className="small muted">×</span>
          <input className="input xs" style={{ width: 60 }} inputMode="numeric" value={x.minutes} aria-label={t("ss.minutes")} onChange={(e) => set(i, { minutes: Math.max(5, Math.min(90, Number(e.target.value.replace(/\D/g, "")) || 5)) })} /><span className="small muted">{t("ss.min")}</span>
          <button type="button" className="iconbtn" aria-label={t("common.delete")} onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))}><Icon name="close" size="sm" /></button>
          <input className="input xs ssfull" value={x.how} placeholder={t("ss.how")} onChange={(e) => set(i, { how: e.target.value })} />
          <input className="input xs ssfull" value={x.search} placeholder={t("ss.search")} onChange={(e) => set(i, { search: e.target.value })} />
        </div>
      ))}
      <button type="button" className="btn plain sm self-start" onClick={() => setItems((xs) => [...xs, { skill: "listening", activity: "", how: "", times_per_week: 2, minutes: 15, search: "", why: "" }])}><Icon name="plus" size="sm" />{t("ss.add")}</button>
      <label className="small font-bold">{t("ss.tips")}<textarea className="textarea mt-1" rows={2} value={tips} onChange={(e) => setTips(e.target.value)} /></label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn primary sm" disabled={pending} onClick={() => run(async () => (await onSave(items.filter((x) => x.activity.trim()), tips.split(/\n+/).map((x) => x.trim()).filter(Boolean))) as never, onClose)}>{t("common.save")}</button>
        <button className="btn secondary sm" onClick={onClose}>{t("common.cancel")}</button>
        <span className="small muted">{t("ss.total", { m: total })}</span>
      </div>
      {error && <div className="alert">{error}</div>}
    </div>
  );
}

export function SelfPlan({ plan, lessons, lessonMin, student, onSave }: { plan: SelfStudy; lessons: number; lessonMin: number; student?: boolean; onSave?: (items: SelfItem[], tips: string[]) => Promise<unknown> }) {
  const { t } = useT();
  const [edit, setEdit] = useState(false);
  if (edit && onSave) return <SelfEdit plan={plan} onSave={onSave} onClose={() => setEdit(false)} />;
  const h = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} ${t("ss.h")}${m % 60 ? ` ${m % 60} ${t("ss.min")}` : ""}` : `${m} ${t("ss.min")}`);
  return (
    <div className="ssplan">
      <div className="ssbar">
        <div><b>{lessons} × {lessonMin} {t("ss.min")}</b><span>{t("ss.lessons")}</span></div>
        <div><b>{h(plan.minutes_per_week)}</b><span>{student ? t("ss.selfYou") : t("ss.self")}</span></div>
        <div><b>≈ {Math.round(plan.minutes_per_week / 7)} {t("ss.min")}</b><span>{t("ss.perDay")}</span></div>
      </div>
      <ul className="sslist">
        {plan.items.map((x, i) => (
          <li key={i}>
            <i style={{ background: COLOR[x.skill] ?? "#8E8E93" }} />
            <div className="grow">
              <div className="flex flex-wrap items-baseline gap-x-2"><b>{x.activity}</b><span className="small muted">{t(`ss.k.${x.skill}`)}</span></div>
              {x.how && <div className="small">{x.how}</div>}
              {!student && x.why && <div className="small muted">{x.why}</div>}
              {x.search && <a className="small alink" href={link(x.skill, x.search)} target="_blank" rel="noopener noreferrer">{t("ss.find")}: {x.search} ↗</a>}
            </div>
            <span className="ssfreq"><b>{x.times_per_week}×</b><span>{x.minutes} {t("ss.min")}</span></span>
          </li>
        ))}
      </ul>
      {plan.tips.length > 0 && <ul className="rbul small mt-2">{plan.tips.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {onSave && <button type="button" className="btn plain sm mt-2" onClick={() => setEdit(true)}><Icon name="pencil" size="sm" />{t("ss.edit")}</button>}
      <p className="hint mb-0 mt-2"><Icon name="info" size="sm" /> {t("ss.basis")}</p>
    </div>
  );
}

/** Ученик: сколько минут в день заниматься самостоятельно (план пересчитывается) и «Распределить в расписании». */
export function StudentSelfControls({ lessons, lessonMin, cur, rec, left }: { lessons: number; lessonMin: number; cur: number; rec: number; left: number }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const mins = [...new Set([10, 15, 20, rec, 30, 40, cur])].sort((a, b) => a - b);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <div className="flex flex-col gap-3">
      <div><b>{t("ss.paceT")}</b><div className="small muted">{t("ss.paceSub")}</div></div>
      <div className="paceopts">
        {mins.map((m) => {
          const wk = Math.max(1, Math.round(left / ((lessons * lessonMin) / 60 + (m * 7) / 60)));
          const d = new Date(Date.now() + wk * 7 * 864e5).toLocaleDateString(loc, { month: "long", year: "numeric" });
          const on = m === cur;
          return (
            <button key={m} type="button" className={`paceopt ${on ? "on" : ""}`} disabled={pending} aria-pressed={on}
              onClick={() => !on && start(async () => { await setStudentPace(`${lessons}:${m}`); router.refresh(); })}>
              <span className="po-a">{t("rm6.paceA", { l: lessons, m })}</span>
              <span className="po-b">{t("rm6.paceB", { w: wk, d })}</span>
              {m === rec && <span className="pill blue">{t("rm6.rec")}</span>}
              {on && <span className="pill green">{t("rm6.chosen")}</span>}
            </button>
          );
        })}
      </div>
      <Link href="/student/schedule#study-recommendations" className="btn primary sm self-start"><Icon name="cal" size="sm" />{t("ss.toSched")}</Link>
    </div>
  );
}
