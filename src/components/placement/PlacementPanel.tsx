"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { closePlacementLink, deletePlacement, createPlacementLink, selfPlacement, setLinkShowResult } from "@/lib/placement/actions";
import { attemptHref, resultFilter, resultsHref, type ResultFilter } from "@/lib/placement/results-filter";
import { useRun } from "../courses/useRun";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { StudentPicker, type GridStudent } from "../teacher/WeekGrid";
import { PlacementAbout } from "./PlacementAbout";
import { useAssignParts } from "./AssignParts";

type PlRow = {
  id: string; who: string; mode: string; status: string; level: string | null; track: string;
  createdAt: number; submittedAt?: number; reviewedAt?: number;
};
const resultFilters = {
  assigned: "pl.listAssigned",
  new: "pl.listNotStarted",
  submitted: "pl.listPending",
  reviewed: "pl.listReviewed",
} as const satisfies Record<ResultFilter, DictKey>;

function dateFor(row: PlRow, filter?: ResultFilter) {
  const status = filter ?? row.status;
  if (status === "reviewed") return row.reviewedAt ?? row.submittedAt ?? row.createdAt;
  if (status === "submitted") return row.submittedAt ?? row.createdAt;
  return row.createdAt;
}

export type PlTrack = "adult" | "teen";
type PlLink = { code: string; showResult: boolean };
/** Teens подходит ученикам 10–17 лет: если возраст известен, версия подставляется сама. */
export const trackForAge = (age: number | null | undefined): PlTrack => (typeof age === "number" && age >= 10 && age <= 17 ? "teen" : "adult");

/** Вводный тест: назначение, гостевая ссылка, самопроверка и результаты. */
export function PlacementPanel({ students, rows, links, origin, owner, teen, timeZone, ages = {} }: { students: GridStudent[]; rows: PlRow[]; links: Partial<Record<PlTrack, PlLink>>; origin: string; owner: boolean; teen: boolean; timeZone: string; ages?: Record<string, number | null> }) {
  const { t, lang } = useT();
  const router = useRouter();
  const { run, pending, error } = useRun();
  const [assign, setAssign] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [exp, setExp] = useState("");
  const ap = useAssignParts(assign ? sid : null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [track, setTrack] = useState<PlTrack>("adult"); // назначение
  const [linkTrack, setLinkTrack] = useState<PlTrack>("adult");
  const [selfTrack, setSelfTrack] = useState<PlTrack>("adult");
  const link = links[linkTrack] ?? null;
  const [copied, setCopied] = useState(false);
  const filter = resultFilter(useSearchParams().get("status"));
  const date = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone });
  const assigned = rows.filter((row) => row.mode === "student");
  const others = rows.filter((row) => row.mode !== "student");
  const counts = { assigned: assigned.length, new: 0, submitted: 0, reviewed: 0 };
  for (const row of assigned) {
    if (row.status === "new" || row.status === "submitted" || row.status === "reviewed") counts[row.status]++;
  }
  const visible = filter === "assigned" ? assigned : assigned.filter((row) => row.status === filter);
  const direction = filter === "new" || filter === "submitted" ? 1 : -1;
  visible.sort((a, b) => direction * (dateFor(a, filter) - dateFor(b, filter)));

  const attemptList = (attempts: PlRow[], currentFilter?: ResultFilter) => (
    <ul className="m-0 list-none p-0">
      {attempts.map((row) => {
        const who = row.who || "—";
        const selfUnfinished = row.mode === "self" && (row.status === "new" || row.status === "active");
        const action = t(row.status === "submitted" ? "pl.listCheck" : row.status === "reviewed" ? "pl.listView" : "pl.listOpen");
        const when = dateFor(row, currentFilter);
        return (
          <li key={row.id} className="plrow flex-wrap gap-y-2 px-0">
            <div className="min-w-0 flex-1 basis-[12rem]">
              <b className="break-words">{who}</b>{row.track === "teen" && <span className="pill ml-2">Teens</span>}
              <small className="muted block">{!currentFilter && <>{t(`pl.mode.${row.mode}` as "pl.mode.self")} · </>}<time dateTime={new Date(when).toISOString()}>{date.format(when)}</time></small>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {row.level && <span className="lvlsm">{row.level}</span>}
              <span className={`pill ${row.status === "reviewed" ? "green" : row.status === "submitted" ? "orange" : "grey"}`}>{t(`pl.st.${row.status}` as "pl.st.new")}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Link href={selfUnfinished ? `/placement/${row.id}` : attemptHref(row.id, currentFilter)} className="alink small" aria-label={`${action}: ${who}`}>{action}</Link>
              <button type="button" className="iconbtn" title={t("pl.delete")} aria-label={`${t("pl.delete")}: ${who}`} disabled={pending} onClick={() => confirm(t("pl.delConfirm")) && run(() => deletePlacement(row.id))}><Icon name="close" size="sm" /></button>
            </div>
          </li>
        );
      })}
    </ul>
  );
  // свой незаконченный тест: спросить — продолжить или начать заново
  const selfOpenOf = (tr: PlTrack) => rows.find((r) => r.mode === "self" && (r.track ?? "adult") === tr && (r.status === "new" || r.status === "active"));
  const selfOpen = selfOpenOf(selfTrack);
  const [selfAsk, setSelfAsk] = useState(false);
  const startSelf = (fresh: boolean) => run(() => selfPlacement(fresh, selfTrack), (r) => router.push(`/placement/${r.id}`), true);
  const url = link ? `${origin}/t/${link.code}` : "";
  const copy = async () => { await navigator.clipboard.writeText(url).catch(() => null); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  return (
    <div className="flex flex-col gap-6">
      <section className="plhero3">
        <div className="plhero3-top">
          <span className="pllogo2" aria-hidden="true"><svg viewBox="0 0 48 48"><rect x="6" y="30" width="8" height="12" rx="2.5" /><rect x="20" y="19" width="8" height="23" rx="2.5" /><rect x="34" y="7" width="8" height="35" rx="2.5" /></svg></span>
          <div className="grow min-w-0">
            <h2>{t("pl.cardTitle")}</h2>
            <div className="plglass">
              <span><Icon name="target" size="sm" />{t("pl.factAny")}</span>
              <span><Icon name="clock" size="sm" />{teen ? t("pl.factTimeBoth") : t("pl.factTime")}</span>
            </div>
          </div>
        </div>
        <p className="plhero3-lead">{t("pl.cardLead")}</p>
        <details className="plmore2">
          <summary><Icon name="info" size="sm" />{t("pl.more")}<Icon name="chevd" size="sm" /></summary>
          <div className="plmore2-body"><PlacementAbout /></div>
        </details>
        <div className="plhero3-actions">
          <button className="btn plwhite" onClick={() => setAssign(true)}><Icon name="user" size="sm" />{t("pl.assign")}</button>
          <button className="btn plglassbtn" onClick={() => setLinkOpen(true)}><Icon name="link" size="sm" />{t("pl.linkNew")}</button>
          <button className="btn plglassbtn" disabled={pending} onClick={() => (teen || selfOpenOf("adult") ? setSelfAsk(true) : startSelf(false))}><Icon name="pencil" size="sm" />{t("pl.takeSelf")}</button>
          {owner && <Link className="plownlink" href="/teacher/placement/bank"><Icon name="book" size="sm" />{t("pl.editBank")}</Link>}
        </div>
        {error && <div className="alert">{error}</div>}
      </section>


      <section className="card">
        <h3 className="mt-0">{t("pl.results")}</h3>
        <div className="seg mb-3 flex-wrap" role="group" aria-label={t("pl.results")}>
          {(Object.keys(resultFilters) as ResultFilter[]).map((key) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => window.history.replaceState(null, "", resultsHref(key))}>
              {t(resultFilters[key])} <span className="muted tabular-nums">{counts[key]}</span>
            </button>
          ))}
        </div>
        {visible.length ? attemptList(visible, filter) : <p className="hint m-0">{t(filter === "assigned" ? "pl.listNoAssignments" : "pl.listEmpty")}</p>}
      </section>
      {others.length > 0 && <details className="card">
        <summary className="cursor-pointer font-semibold">{t("pl.listOther")} <span className="muted">{others.length}</span></summary>
        {attemptList(others)}
      </details>}

      <Dialog open={selfAsk} onClose={() => setSelfAsk(false)} title={t("pl.takeSelf")}>
        {teen && <TrackField value={selfTrack} onChange={setSelfTrack} />}
        {selfOpen ? (
          <>
            <p className="mt-3">{t("pl.selfAsk", { d: date.format(selfOpen.createdAt) })}</p>
            <div className="actions">
              <button className="btn secondary" disabled={pending} onClick={() => { setSelfAsk(false); startSelf(true); }}>{t("pl.selfNew")}</button>
              <button className="btn primary" onClick={() => { setSelfAsk(false); router.push(`/placement/${selfOpen.id}`); }}>{t("pl.selfContinue")}</button>
            </div>
          </>
        ) : <div className="actions mt-3"><button className="btn primary" disabled={pending} onClick={() => { setSelfAsk(false); startSelf(false); }}>{t("pl.start")}</button></div>}
      </Dialog>

      <Dialog open={assign} onClose={() => setAssign(false)} title={t("pl.assign")}>
        {students.length === 0 ? <p className="hint m-0">{t("sch.noStudents")}</p> : <StudentPicker students={students} value={sid} onChange={(v) => { setSid(v); if (teen && v) setTrack(trackForAge(ages[v])); }} />}
        {sid && ap.ui}
        {teen && !ap.useInto && <TrackField value={track} onChange={setTrack} age={sid ? ages[sid] : null} />}
        {!ap.useInto && <ExpectField value={exp} onChange={setExp} teen={track === "teen"} need={ap.needLevel} />}
        <Steps keys={["pl.assignS1", "pl.assignS2", "pl.assignS3", "pl.assignS4"]} tip="pl.assignTip" />
        <div className="actions"><button className="btn secondary" onClick={() => setAssign(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending || !sid || ap.blocked(exp)} onClick={() => run(() => ap.submit(exp, track), () => { setAssign(false); setSid(null); setExp(""); setTrack("adult"); ap.reset(); })}>{ap.useInto ? t("pl.partsAddDo") : t("pl.assignDo")}</button></div>
      </Dialog>

      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} title={t("pl.linkNew")}>
        {teen && <TrackField value={linkTrack} onChange={setLinkTrack} />}
        <Steps keys={["pl.linkS1", "pl.linkS2", "pl.linkS3", "pl.linkS4"]} tip="pl.linkTip" />
        {link ? (
          <>
            <div className="flex gap-2"><input className="input grow" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t("pl.linkNew")} /><button className="btn primary" onClick={copy}><Icon name="copy" size="sm" />{copied ? t("pl.copied") : t("pl.copy")}</button></div>
            <label className="setting mt-3"><span>{t("pl.linkShow")}<span className="small muted block">{t("pl.linkShowHint")}</span></span>
              <span className="switch"><input type="checkbox" checked={link.showResult} disabled={pending} onChange={(e) => run(() => setLinkShowResult(link.code, e.target.checked))} /><span /></span></label>
            <div className="actions"><button className="btn plain" disabled={pending} onClick={() => { if (confirm(t("pl.linkCloseConfirm"))) run(() => closePlacementLink(link.code)); }}>{t("pl.linkClose")}</button>
              <button className="btn secondary" disabled={pending} onClick={() => run(() => createPlacementLink(link.showResult, linkTrack))}>{t("pl.linkRenew")}</button></div>
          </>
        ) : (
          <div className="actions"><button className="btn primary" disabled={pending} onClick={() => run(() => createPlacementLink(false, linkTrack))}>{t("pl.linkCreate")}</button></div>
        )}
      </Dialog>
    </div>
  );
}

/** «Как это работает» — нумерованные шаги и совет под ними. */
export function Steps({ keys, tip }: { keys: DictKey[]; tip?: DictKey }) {
  const { t } = useT();
  return (
    <div className="plhow mt-3">
      <b className="small">{t("pl.howTitle")}</b>
      <ol>{keys.map((k) => <li key={k}>{t(k)}</li>)}</ol>
      {tip && <p className="small muted m-0"><Icon name="info" size="sm" /> {t(tip)}</p>}
    </div>
  );
}

/** Версия теста: взрослый или Placement test Teens (10–17 лет). */
export function TrackField({ value, onChange, age }: { value: PlTrack; onChange: (v: PlTrack) => void; age?: number | null }) {
  const { t } = useT();
  return (
    <div className="field mt-3">
      <label>{t("pl.track")}</label>
      <div className="seg" role="group" aria-label={t("pl.track")}>
        {(["adult", "teen"] as const).map((k) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{t(k === "teen" ? "pl.trackTeen" : "pl.trackAdult")}</button>)}
      </div>
      {typeof age === "number" && <span className="small muted">{t(trackForAge(age) === "teen" ? "pl.trackAgeTeen" : "pl.trackAgeAdult", { n: age })}</span>}
    </div>
  );
}

/** Ожидаемый уровень ученика: тест начнёт с него и пропустит разминку. */
export function ExpectField({ value, onChange, teen = false, need = false }: { value: string; onChange: (v: string) => void; teen?: boolean; need?: boolean }) {
  const { t } = useT();
  return (
    <div className="field mt-3">
      <label htmlFor="pl-exp">{need ? t("pl.partsLevelNeed") : t("pl.expect")}</label>
      <select id="pl-exp" className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{need ? "—" : t("pl.expNone")}</option><option value="A1">{t(teen ? "plt.expA1" : "pl.expA1")}</option><option value="B1">{t(teen ? "plt.expB1" : "pl.expB1")}</option><option value="B2">{t(teen ? "plt.expB2" : "pl.expB2")}</option>
      </select>
      {!need && <span className="small muted">{t("pl.expectHint")}</span>}
    </div>
  );
}
