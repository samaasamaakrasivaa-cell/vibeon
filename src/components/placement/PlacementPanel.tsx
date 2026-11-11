"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { assignPlacement, closePlacementLink, createPlacementLink, selfPlacement, setLinkShowResult } from "@/lib/placement/actions";
import { useRun } from "../courses/useRun";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { StudentPicker, type GridStudent } from "../teacher/WeekGrid";
import { PlacementAbout } from "./PlacementAbout";

export type PlRow = { id: string; who: string; mode: string; status: string; level: string | null; when: string };

/** «Курсы → Тесты»: вводный тест — пройти самой, назначить ученику, ссылка для нового человека, результаты. */
export function PlacementPanel({ students, rows, link, origin, owner }: { students: GridStudent[]; rows: PlRow[]; link: { code: string; showResult: boolean } | null; origin: string; owner: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const { run, pending, error } = useRun();
  const [assign, setAssign] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [exp, setExp] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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
              <span><Icon name="clock" size="sm" />{t("pl.factTime")}</span>
            </div>
          </div>
        </div>
        <p className="plhero3-lead">{t("pl.cardLead")}</p>
        <details className="plmore2">
          <summary><Icon name="info" size="sm" />{t("pl.more")}<Icon name="chevd" size="sm" /></summary>
          <div className="plmore2-body"><PlacementAbout /></div>
        </details>
        <div className="plhero3-actions">
          <button className="btn plwhite" disabled={pending} onClick={() => run(selfPlacement, (r) => router.push(`/placement/${r.id}`), true)}><Icon name="pencil" size="sm" />{t("pl.takeSelf")}</button>
          <button className="btn plglassbtn" onClick={() => setAssign(true)}><Icon name="user" size="sm" />{t("pl.assign")}</button>
          <span className="pltipwrap" data-tip={t("pl.linkTip")}><button className="btn plglassbtn" onClick={() => setLinkOpen(true)} aria-describedby="pl-link-tip"><Icon name="link" size="sm" />{t("pl.linkNew")}</button><span id="pl-link-tip" className="sr-only">{t("pl.linkTip")}</span></span>
          {owner && <Link className="plownlink" href="/teacher/placement/bank"><Icon name="book" size="sm" />{t("pl.editBank")}</Link>}
        </div>
        {error && <div className="alert">{error}</div>}
      </section>


      <section className="card">
        <h3 className="mt-0">{t("pl.results")}</h3>
        {rows.length === 0 ? <p className="hint m-0">{t("pl.noResults")}</p> : (
          <div className="flex flex-col">
            {rows.map((r) => (
              <Link key={r.id} href={`/teacher/placement/${r.id}`} className="plrow">
                <span className="grow min-w-0"><b className="truncate block">{r.who}</b><span className="small muted">{t(`pl.mode.${r.mode}` as "pl.mode.self")} · {r.when}</span></span>
                {r.level && <span className="lvlsm">{r.level}</span>}
                <span className={`pill ${r.status === "reviewed" ? "green" : r.status === "submitted" ? "orange" : "grey"}`}>{t(`pl.st.${r.status}` as "pl.st.new")}</span>
                <Icon name="right" size="sm" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <Dialog open={assign} onClose={() => setAssign(false)} title={t("pl.assign")}>
        {students.length === 0 ? <p className="hint m-0">{t("sch.noStudents")}</p> : <StudentPicker students={students} value={sid} onChange={setSid} />}
        <ExpectField value={exp} onChange={setExp} />
        <p className="small muted">{t("pl.assignHint")}</p>
        <div className="actions"><button className="btn secondary" onClick={() => setAssign(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending || !sid} onClick={() => run(() => assignPlacement(sid!, exp || null), () => { setAssign(false); setSid(null); setExp(""); })}>{t("pl.assignDo")}</button></div>
      </Dialog>

      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} title={t("pl.linkNew")}>
        <p className="small muted mt-0">{t("pl.linkLead")}</p>
        {link ? (
          <>
            <div className="flex gap-2"><input className="input grow" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t("pl.linkNew")} /><button className="btn primary" onClick={copy}><Icon name="copy" size="sm" />{copied ? t("pl.copied") : t("pl.copy")}</button></div>
            <label className="setting mt-3"><span>{t("pl.linkShow")}<span className="small muted block">{t("pl.linkShowHint")}</span></span>
              <span className="switch"><input type="checkbox" checked={link.showResult} disabled={pending} onChange={(e) => run(() => setLinkShowResult(link.code, e.target.checked))} /><span /></span></label>
            <div className="actions"><button className="btn plain" disabled={pending} onClick={() => { if (confirm(t("pl.linkCloseConfirm"))) run(() => closePlacementLink(link.code)); }}>{t("pl.linkClose")}</button>
              <button className="btn secondary" disabled={pending} onClick={() => run(() => createPlacementLink(link.showResult))}>{t("pl.linkRenew")}</button></div>
          </>
        ) : (
          <div className="actions"><button className="btn primary" disabled={pending} onClick={() => run(() => createPlacementLink(false))}>{t("pl.linkCreate")}</button></div>
        )}
      </Dialog>
    </div>
  );
}

/** Ожидаемый уровень ученика: тест начнёт с него и пропустит разминку. */
export function ExpectField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  return (
    <div className="field mt-3">
      <label htmlFor="pl-exp">{t("pl.expect")}</label>
      <select id="pl-exp" className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("pl.expNone")}</option><option value="A1">{t("pl.expA1")}</option><option value="B1">{t("pl.expB1")}</option><option value="B2">{t("pl.expB2")}</option>
      </select>
      <span className="small muted">{t("pl.expectHint")}</span>
    </div>
  );
}
