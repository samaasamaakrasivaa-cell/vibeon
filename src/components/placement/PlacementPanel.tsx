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

export type PlRow = { id: string; who: string; mode: string; status: string; level: string | null; when: string };

/** «Курсы → Тесты»: вводный тест — пройти самой, назначить ученику, ссылка для нового человека, результаты. */
export function PlacementPanel({ students, rows, link, origin, owner }: { students: GridStudent[]; rows: PlRow[]; link: { code: string; showResult: boolean } | null; origin: string; owner: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const { run, pending, error } = useRun();
  const [assign, setAssign] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = link ? `${origin}/t/${link.code}` : "";
  const copy = async () => { await navigator.clipboard.writeText(url).catch(() => null); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  return (
    <div className="flex flex-col gap-6">
      <section className="card plcard">
        <div className="flex flex-wrap items-start gap-4">
          <span className="plico"><Icon name="target" /></span>
          <div className="grow min-w-[240px] flex-1">
            <h2 className="m-0">{t("pl.cardTitle")}</h2>
            <p className="muted mt-1 mb-0">{t("pl.cardLead")}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{["core", "reading", "listening", "writing", "speaking"].map((p) => <span key={p} className="pill grey">{t(`pl.part.${p}` as "pl.part.core")}</span>)}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn primary" disabled={pending} onClick={() => run(selfPlacement, (r) => router.push(`/placement/${r.id}`), true)}><Icon name="pencil" size="sm" />{t("pl.takeSelf")}</button>
          <button className="btn secondary" onClick={() => setAssign(true)}><Icon name="user" size="sm" />{t("pl.assign")}</button>
          <button className="btn secondary" onClick={() => setLinkOpen(true)}><Icon name="link" size="sm" />{t("pl.linkNew")}</button>
          {owner && <Link className="btn plain" href="/teacher/placement/bank"><Icon name="book" size="sm" />{t("pl.editBank")}</Link>}
        </div>
        {error && <div className="alert mt-3">{error}</div>}
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
        <p className="small muted">{t("pl.assignHint")}</p>
        <div className="actions"><button className="btn secondary" onClick={() => setAssign(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending || !sid} onClick={() => run(() => assignPlacement(sid!), () => { setAssign(false); setSid(null); })}>{t("pl.assignDo")}</button></div>
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
