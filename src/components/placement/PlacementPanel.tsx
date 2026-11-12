"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { assignPlacement, closePlacementLink, createPlacementLink, selfPlacement, setLinkShowResult } from "@/lib/placement/actions";
import { useRun } from "../courses/useRun";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { StudentPicker, type GridStudent } from "../teacher/WeekGrid";
import { PlacementAbout } from "./PlacementAbout";

export type PlRow = { id: string; who: string; mode: string; status: string; level: string | null; when: string; track?: string };
export type PlTrack = "adult" | "teen";
type PlLink = { code: string; showResult: boolean };
/** Teens подходит ученикам 10–17 лет: если возраст известен, версия подставляется сама. */
export const trackForAge = (age: number | null | undefined): PlTrack => (typeof age === "number" && age >= 10 && age <= 17 ? "teen" : "adult");

/** «Курсы → Тесты»: вводный тест — пройти самой, назначить ученику, ссылка для нового человека, результаты. */
export function PlacementPanel({ students, rows, links, origin, owner, teen, ages = {} }: { students: GridStudent[]; rows: PlRow[]; links: Partial<Record<PlTrack, PlLink>>; origin: string; owner: boolean; teen: boolean; ages?: Record<string, number | null> }) {
  const { t } = useT();
  const router = useRouter();
  const { run, pending, error } = useRun();
  const [assign, setAssign] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [exp, setExp] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [track, setTrack] = useState<PlTrack>("adult"); // назначение
  const [linkTrack, setLinkTrack] = useState<PlTrack>("adult");
  const [selfTrack, setSelfTrack] = useState<PlTrack>("adult");
  const link = links[linkTrack] ?? null;
  const [copied, setCopied] = useState(false);
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
        {rows.length === 0 ? <p className="hint m-0">{t("pl.noResults")}</p> : (
          <div className="flex flex-col">
            {rows.map((r) => (
              <Link key={r.id} href={r.mode === "self" && (r.status === "new" || r.status === "active") ? `/placement/${r.id}` : `/teacher/placement/${r.id}`} className="plrow">
                <span className="grow min-w-0"><b className="truncate block">{r.who}{r.track === "teen" && <span className="pill ml-2">Teens</span>}</b><span className="small muted">{t(`pl.mode.${r.mode}` as "pl.mode.self")} · {r.when}</span></span>
                {r.level && <span className="lvlsm">{r.level}</span>}
                <span className={`pill ${r.status === "reviewed" ? "green" : r.status === "submitted" ? "orange" : "grey"}`}>{t(`pl.st.${r.status}` as "pl.st.new")}</span>
                <Icon name="right" size="sm" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <Dialog open={selfAsk} onClose={() => setSelfAsk(false)} title={t("pl.takeSelf")}>
        {teen && <TrackField value={selfTrack} onChange={setSelfTrack} />}
        {selfOpen ? (
          <>
            <p className="mt-3">{t("pl.selfAsk", { d: selfOpen.when })}</p>
            <div className="actions">
              <button className="btn secondary" disabled={pending} onClick={() => { setSelfAsk(false); startSelf(true); }}>{t("pl.selfNew")}</button>
              <button className="btn primary" onClick={() => { setSelfAsk(false); router.push(`/placement/${selfOpen.id}`); }}>{t("pl.selfContinue")}</button>
            </div>
          </>
        ) : <div className="actions mt-3"><button className="btn primary" disabled={pending} onClick={() => { setSelfAsk(false); startSelf(false); }}>{t("pl.start")}</button></div>}
      </Dialog>

      <Dialog open={assign} onClose={() => setAssign(false)} title={t("pl.assign")}>
        {students.length === 0 ? <p className="hint m-0">{t("sch.noStudents")}</p> : <StudentPicker students={students} value={sid} onChange={(v) => { setSid(v); if (teen && v) setTrack(trackForAge(ages[v])); }} />}
        {teen && <TrackField value={track} onChange={setTrack} age={sid ? ages[sid] : null} />}
        <ExpectField value={exp} onChange={setExp} teen={track === "teen"} />
        <Steps keys={["pl.assignS1", "pl.assignS2", "pl.assignS3", "pl.assignS4"]} tip="pl.assignTip" />
        <div className="actions"><button className="btn secondary" onClick={() => setAssign(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending || !sid} onClick={() => run(() => assignPlacement(sid!, exp || null, track), () => { setAssign(false); setSid(null); setExp(""); setTrack("adult"); })}>{t("pl.assignDo")}</button></div>
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
export function ExpectField({ value, onChange, teen = false }: { value: string; onChange: (v: string) => void; teen?: boolean }) {
  const { t } = useT();
  return (
    <div className="field mt-3">
      <label htmlFor="pl-exp">{t("pl.expect")}</label>
      <select id="pl-exp" className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("pl.expNone")}</option><option value="A1">{t(teen ? "plt.expA1" : "pl.expA1")}</option><option value="B1">{t(teen ? "plt.expB1" : "pl.expB1")}</option><option value="B2">{t(teen ? "plt.expB2" : "pl.expB2")}</option>
      </select>
      <span className="small muted">{t("pl.expectHint")}</span>
    </div>
  );
}
