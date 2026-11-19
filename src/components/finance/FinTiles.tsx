"use client";
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { StudentAvatar } from "../awards/Medal";
import { Icon } from "../Icon";

export type FinRow = { id: string; sid?: string; avatar?: string | null; group?: boolean; title: string; sub?: string; right?: string; tone?: "bad" | "muted" };
export type FinTile = { key: string; icon: Parameters<typeof Icon>[0]["name"]; color?: string; value: string; label: string; note?: string; main?: boolean; bad?: boolean; rows: FinRow[]; head?: string };

/** Плитки финансов: нажали — под плитками раскрывается расшифровка (кто и сколько, когда). */
export function FinTiles({ tiles }: { tiles: FinTile[] }) {
  const { t } = useT();
  const [open, setOpen] = useState<string | null>(null);
  const cur = tiles.find((x) => x.key === open);
  return (
    <>
      <div className="grid-3">
        {tiles.map((x) => (
          <button key={x.key} type="button" className={`fintile ${x.main ? "main" : ""} ${open === x.key ? "on" : ""}`} aria-expanded={open === x.key} onClick={() => setOpen(open === x.key ? null : x.key)}>
            <span className="si" style={x.color ? { background: x.color } : undefined}><Icon name={x.icon} /></span>
            <div className="grow min-w-0 text-left">
              <b className={x.bad ? "text-bad" : ""}>{x.value}</b>
              <span>{x.label}</span>
              {x.note && <span className="fin-note">{x.note}</span>}
            </div>
            <span className="fin-chev" aria-hidden="true"><Icon name="chevd" size="sm" /></span>
          </button>
        ))}
      </div>
      {cur && (
        <section className="findet" aria-live="polite">
          <div className="findet-h">
            <b>{cur.label}</b>
            {cur.head && <span className="small muted">{cur.head}</span>}
            <button type="button" className="iconbtn ml-auto" aria-label={t("common.close")} onClick={() => setOpen(null)}><Icon name="close" size="sm" /></button>
          </div>
          {cur.rows.length === 0 ? <p className="hint m-0 px-1">{t("fin.det.none")}</p> : (
            <ul className="findet-list">
              {cur.rows.map((r) => {
                const inner = (
                  <>
                    {r.group ? <span className="findet-g"><Icon name="users" size="sm" /></span> : r.sid ? <StudentAvatar id={r.sid} avatar={r.avatar ?? null} size={32} /> : null}
                    <span className="grow min-w-0"><span className="findet-t">{r.title}</span>{r.sub && <span className="findet-s">{r.sub}</span>}</span>
                    {r.right && <span className={`findet-r ${r.tone === "bad" ? "text-bad" : r.tone === "muted" ? "muted" : ""}`}>{r.right}</span>}
                  </>
                );
                return <li key={r.id}>{r.sid && !r.group ? <Link href={`/teacher/students/${r.sid}`}>{inner}</Link> : <div>{inner}</div>}</li>;
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
