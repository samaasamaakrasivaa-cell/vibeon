"use client";
import { useEffect, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { revealState, toggleReveal } from "@/lib/placement/actions";
import type { ReviewData } from "@/lib/placement/review";
import { Icon } from "../Icon";

/**
 * Разбор ответов. Учитель видит скрипты и «глазиком» открывает их ученику;
 * ученик видит скрипт, только пока учитель его открыл (страница спрашивает раз в 3 секунды).
 */
export const fmtSec = (ms: number) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} с` : `${Math.floor(ms / 60000)} мин ${Math.round((ms % 60000) / 1000)} с`);

export function PlacementAnswers({ id, d, teacher, reveal: initial }: { id: string; d: ReviewData; teacher: boolean; reveal: string[] }) {
  const { t } = useT();
  const [open, setOpen] = useState<Record<string, string>>({});
  const [rev, setRev] = useState<string[]>(initial);
  const [, start] = useTransition();
  useEffect(() => {
    if (teacher) return;
    let stop = false;
    const tick = async () => { const r = await revealState(id).catch(() => null); if (!stop && r) setOpen(r); };
    void tick();
    const h = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(h); };
  }, [id, teacher]);
  const flip = (itemId: string) => start(async () => {
    setRev((r) => (r.includes(itemId) ? r.filter((x) => x !== itemId) : [...r, itemId]));
    await toggleReveal(id, itemId);
  });
  const L = ["A1", "A2", "B1", "B2", "C1"];
  return (
    <div className="flex flex-col gap-4">
      <section className="card">
        <h3 className="mt-0">{t("pl.part.core")}</h3>
        {L.filter((l) => d.core.some((x) => x.level === l)).map((l) => (
          <div key={l} className="mb-3">
            <div className="plab">{l}</div>
            <div className="flex flex-col gap-2">
              {d.core.filter((x) => x.level === l).map((x) => (
                <div key={x.id} className={`plans ${x.ok ? "ok" : "bad"}`}>
                  <div className="flex items-start gap-2"><Icon name={x.ok ? "check" : "close"} size="sm" /><div className="grow">
                    {x.base && <span className="plbase sm">{x.base}</span>} {x.type === "transform" ? <><span>{x.q}</span><br /><span>{x.frame}</span></> : <span>{x.q}</span>}
                    <div className="small mt-1">{x.ok ? <b>{x.given}</b> : <>{x.dk ? <span className="pill grey">{t("pl.dontKnow")}</span> : <s className="muted">{x.given || t("pl.noAnswer")}</s>} → <b>{x.right}</b></>}</div>
                    <div className="small muted">{x.topic}{x.explain ? ` · ${x.explain}` : ""}</div>
                  </div>{teacher && x.ms !== null && <span className={`plms ${x.ms < 3000 ? "fast" : x.ms > 60000 ? "slow" : ""}`} title={x.ms < 3000 ? t("pl.fastHint") : undefined}>{fmtSec(x.ms)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
      {[...d.reading, ...d.listening].map((x) => (
        <section key={x.id} className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill grey">{t(x.kind === "reading" ? "pl.part.reading" : "pl.part.listening")} · {x.level}</span>
            <h3 className="m-0 grow">{x.title}</h3>
            {teacher && x.plays !== null && <span className="small muted">{t("pl.playsUsed", { n: x.plays })}</span>}
            {teacher && x.kind === "listening" && (
              <button type="button" className={`btn sm ${rev.includes(x.id) ? "primary" : "secondary"}`} aria-pressed={rev.includes(x.id)} onClick={() => flip(x.id)} title={t("pl.eyeHint")}>
                <Icon name={rev.includes(x.id) ? "eye" : "eyeoff"} size="sm" />{rev.includes(x.id) ? t("pl.scriptShown") : t("pl.showScript")}
              </button>
            )}
          </div>
          {x.passage && <details><summary className="small">{t("pl.textShow")}</summary><div className="tpassage plpassage mt-2">{x.passage}</div></details>}
          {x.audio && <audio controls src={x.audio} className="w-full" preload="none" />}
          {teacher && x.script && <details><summary className="small">{t("pl.script")}</summary><div className="tpassage plscript mt-2">{x.script}</div></details>}
          {!teacher && open[x.id] && <div className="tpassage plscript"><div className="small mb-1 font-bold"><Icon name="eye" size="sm" /> {t("pl.script")}</div>{open[x.id]}</div>}
          {x.questions.map((q, n) => (
            <div key={q.id} className={`plans ${q.ok ? "ok" : "bad"}`}>
              <div className="flex items-start gap-2"><Icon name={q.ok ? "check" : "close"} size="sm" /><div className="grow">
                <span>{n + 1}. {q.q}</span>
                <div className="small mt-1">{q.ok ? <b>{q.options[q.answer]}</b> : <>{q.dk ? <span className="pill grey">{t("pl.dontKnow")}</span> : <s className="muted">{q.given === null ? t("pl.noAnswer") : q.options[Number(q.given)]}</s>} → <b>{q.options[q.answer]}</b></>}</div>
                {q.explain && <div className="small muted">{q.explain}</div>}
              </div></div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
