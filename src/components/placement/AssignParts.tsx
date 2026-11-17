"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { useT } from "@/lib/i18n/client";
import { addSections, assignPlacement, placementInfo, type PlInfo } from "@/lib/placement/actions";
import { Icon } from "../Icon";

export const PL_PARTS = ["core", "vocab", "reading", "listening", "writing", "speaking"] as const;
const DONE = ["submitted", "reviewed"];

/** Назначение теста по разделам: что проверяем, от какого уровня идут разделы без грамматики,
 *  добавить ли новые разделы в прошлый тест (пройденные разделы — только новым тестом). */
export function useAssignParts(sid: string | null) {
  const { t } = useT();
  const [parts, setParts] = useState<string[]>([...PL_PARTS]);
  const [info, setInfo] = useState<PlInfo | null>(null);
  const [into, setInto] = useState(true);
  useEffect(() => {
    setInfo(null);
    if (!sid) return;
    let on = true;
    placementInfo(sid).then((x) => on && setInfo(x)).catch(() => null);
    return () => { on = false; };
  }, [sid]);

  const all = parts.length === PL_PARTS.length;
  const noCore = !parts.includes("core");
  const last = info?.last && DONE.includes(info.last.status) && info.last.parts.length < PL_PARTS.length ? info.last : null;
  const repeated = last ? parts.filter((x) => last.done.includes(x)) : [];
  // в прошлый тест можно добавить только разделы, которых там ещё нет (грамматику — не после лексики)
  const canInto = !!last && parts.length > 0 && repeated.length === 0 && !(parts.includes("core") && last.done.includes("vocab"));
  const useInto = canInto && into;
  const needLevel = noCore && !useInto && !info?.grammar && !(last && last.done.includes("core"));
  const toggle = (k: string) => setParts((p) => (p.includes(k) ? p.filter((x) => x !== k) : PL_PARTS.filter((x) => x === k || p.includes(x))));
  const name = (k: string) => t(`pl.part.${k}` as "pl.part.core");

  const ui = (
    <div className="field mt-3">
      <span className="flabel">{t("pl.partsPick")}</span>
      <div className="chips" role="group" aria-label={t("pl.partsPick")}>
        <label className="chip"><input type="checkbox" checked={all} onChange={() => setParts(all ? ["core"] : [...PL_PARTS])} /><span>{t("pl.partsAll")}</span></label>
        {PL_PARTS.map((k) => (
          <label key={k} className="chip"><input type="checkbox" name="pl-part" value={k} checked={parts.includes(k)} onChange={() => toggle(k)} /><span>{name(k)}{last?.dates[k] ? ` · ${last.dates[k]}` : ""}</span></label>
        ))}
      </div>
      <span className="small muted">{t("pl.partsPickHint")}</span>
      {canInto && (
        <label className="setting mt-2">
          <span><b className="small">{t("pl.partsInto", { d: last!.when })}</b><br /><span className="small muted">{t("pl.partsIntoHint")}</span></span>
          <span className="switch"><input type="checkbox" checked={into} onChange={(e) => setInto(e.target.checked)} /><span /></span>
        </label>
      )}
      {repeated.length > 0 && <p className="hint m-0 mt-2"><Icon name="info" size="sm" /> {t("pl.partsRepeat", { s: repeated.map(name).join(", "), d: last!.when })}</p>}
      {noCore && !useInto && (info?.grammar
        ? <p className="hint m-0 mt-2">{t("pl.partsLevelTest", { d: info.grammar.when, l: info.grammar.sub })}</p>
        : <p className="alert calm m-0 mt-2 small">{t("pl.partsLevelPick")}</p>)}
    </div>
  );

  const submit = (exp: string, track: "adult" | "teen") =>
    useInto ? addSections(last!.id, parts) : assignPlacement(sid!, exp || null, track, all ? null : parts);
  const blocked = (exp: string) => parts.length === 0 || (needLevel && !exp);
  return { ui, submit, parts, needLevel, blocked, useInto, reset: () => { setParts([...PL_PARTS]); setInto(true); } };
}

/** Результат теста: какие разделы входили, когда пройден каждый, и «Добавить разделы» в этот же тест. */
export function PlacementParts({ id, parts, done, dates, canAdd }: { id: string; parts: string[]; done: string[]; dates: Record<string, string>; canAdd: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const free = PL_PARTS.filter((k) => !done.includes(k));
  const lateCore = done.includes("vocab"); // грамматику после лексики — только новым тестом
  const name = (k: string) => t(`pl.part.${k}` as "pl.part.core");
  const add = () => start(async () => {
    setError(null);
    const r = await addSections(id, pick);
    if (!r.ok) return setError(r.error);
    setOpen(false); setPick([]); router.refresh();
  });
  return (
    <div className="plparts">
      <span className="small muted">{t("pl.parts")}:</span>
      {PL_PARTS.map((k) => {
        const inTest = parts.includes(k), ok = done.includes(k);
        return <span key={k} className={`pill ${ok ? "green" : inTest ? "grey" : "outline"}`}>{name(k)}{ok && dates[k] ? <small>{dates[k]}</small> : !inTest ? <small>—</small> : null}</span>;
      })}
      {canAdd && free.length > 0 && <button type="button" className="btn secondary sm" onClick={() => setOpen(true)}><Icon name="plus" size="sm" />{t("pl.partsAdd")}</button>}
      <Dialog open={open} onClose={() => setOpen(false)} title={t("pl.partsAdd")}>
        <div className="chips">
          {free.map((k) => {
            const off = k === "core" && lateCore;
            return <label key={k} className="chip" title={off ? t("pl.partsCoreLate") : undefined}><input type="checkbox" disabled={off} checked={pick.includes(k)} onChange={() => setPick((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} /><span>{name(k)}{off ? ` · ${t("pl.partsCoreLate")}` : ""}</span></label>;
          })}
        </div>
        <p className="hint mt-3 mb-0">{t("pl.partsAddHint")}</p>
        {error && <div className="alert mt-3">{error}</div>}
        <div className="actions">
          <button className="btn secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending || pick.length === 0} onClick={add}>{t("pl.partsAddDo")}</button>
        </div>
      </Dialog>
    </div>
  );
}
