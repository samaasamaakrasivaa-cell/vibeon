"use client";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { METALS, nameFor, whyFor, type CatalogItem } from "@/lib/awards/catalog";
import { PhraseLangSwitch, usePhraseLang, type PL } from "./PhraseLang";
import { giveAward } from "@/lib/awards/actions";
import { setStudentField } from "@/lib/teacher/actions";
import { Dialog } from "../Dialog";
import { Medal } from "./Medal";

export type CheerTo = { sid: string; name: string; gender: string | null; inClass: boolean };

/** Урок → «Подарить приятность»: тёплое поощрение ученику; если он в классе — праздничное окно появится у него сразу. */
export function LessonCheer({ to, onClose, onGiven, catalog: CATALOG }: { to: CheerTo[]; onClose: () => void; onGiven: (awardId: string) => Promise<unknown>; catalog: CatalogItem[] }) {
  const { t } = useT();
  const [L, setL] = usePhraseLang(); // язык фразы: по-русски или по-английски
  const [sid, setSid] = useState<string | null>(to.length === 1 ? to[0].sid : null);
  const who = to.find((x) => x.sid === sid) ?? null;
  const [genders, setGenders] = useState<Record<string, string | null>>(() => Object.fromEntries(to.map((x) => [x.sid, x.gender])));
  const gender = sid ? genders[sid] ?? null : null;
  const list = useMemo(() => {
    const nice = CATALOG.filter((c) => c.group === "nice");
    // тёплые — первыми, привычные «Отличная работа» и «Спасибо за старание» — в конце
    return [...nice.filter((c) => !["great", "sunny", "effort"].includes(c.key)), ...nice.filter((c) => ["great", "sunny", "effort"].includes(c.key))];
  }, []);
  const [pick, setPick] = useState<CatalogItem | null>(null);
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  const [tg, setTg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const choose = (c: CatalogItem) => { setPick(c); setName(nameFor(c, L, gender)); setWhy(whyFor(c, L, gender)); };
  const switchLang = (v: PL) => { setL(v); if (pick) { setName(nameFor(pick, v, gender)); setWhy(whyFor(pick, v, gender)); } };
  const gendered = pick && L === "ru" && (typeof pick.name.ru !== "string" || /\(а\)/.test(pick.name.ru + pick.why.ru));
  const setG = (v: "f" | "m") => {
    if (!sid) return;
    setGenders((g) => ({ ...g, [sid]: v }));
    if (pick) { setName(nameFor(pick, L, v)); setWhy(whyFor(pick, L, v)); }
    void setStudentField(sid, "gender", v);
  };
  const give = async () => {
    if (!sid || !pick) return;
    setBusy(true); setErr(false);
    const r = await giveAward(sid, { kind: "cheer", key: pick.key, name, why, icon: pick.icon, color: pick.color, term: "forever", onMain: false, tg: tg || !who?.inClass });
    if (r.ok && r.id) { await onGiven(r.id); setDone(who?.name.split(" ")[0] ?? ""); }
    else setErr(true);
    setBusy(false);
  };
  return (
    <Dialog open onClose={onClose} title={t("chr.title")} wide>
      {done !== null ? (
        <>
          <p className="alert ok">✓ {who?.inClass ? t("chr.doneLive", { n: done }) : t("chr.done", { n: done })}</p>
          <div className="actions">
            {to.length > 1 && <button type="button" className="btn secondary" onClick={() => { setDone(null); setPick(null); setSid(null); }}>{t("chr.more")}</button>}
            <button type="button" className="btn primary" onClick={onClose}>{t("common.close")}</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted mt-0">{t("chr.hint")}</p>
          <PhraseLangSwitch value={L} onChange={switchLang} />
          {to.length > 1 && (
            <div className="field mb-3"><span className="flabel">{t("grp.fbTo")}</span>
              <div className="flex flex-wrap gap-1.5">{to.map((m) => <button key={m.sid} type="button" className={`pchip ${sid === m.sid ? "on" : ""}`} aria-pressed={sid === m.sid} onClick={() => { setSid(m.sid); if (pick) { setName(nameFor(pick, L, genders[m.sid])); setWhy(whyFor(pick, L, genders[m.sid])); } }}>{m.name}</button>)}</div>
            </div>
          )}
          <div className="awgrid chrgrid">
            {list.map((c) => (
              <button key={c.key} type="button" className={`awcard ${pick?.key === c.key ? "on" : ""}`} onClick={() => choose(c)}>
                <Medal icon={c.icon} color={c.color} size={36} shape="circle" />
                <b>{nameFor(c, L, gender)}</b>
              </button>
            ))}
          </div>
          {pick && (
            <div className="chrform">
              <Medal icon={pick.icon} color={pick.color} size={64} shape="circle" />
              <div className="grow min-w-0 flex flex-col gap-2">
                <input className="input" value={name} maxLength={80} aria-label={t("aw.name")} onChange={(e) => setName(e.target.value)} style={{ color: METALS[pick.color].text, fontWeight: 700 }} />
                {gendered && (
                  <div className="seg self-start">
                    <button type="button" aria-pressed={gender === "f"} onClick={() => setG("f")}>{t("aw.she")}</button>
                    <button type="button" aria-pressed={gender === "m"} onClick={() => setG("m")}>{t("aw.he")}</button>
                  </div>
                )}
                <textarea className="textarea" rows={2} value={why} maxLength={500} aria-label={t("aw.why")} placeholder={t("chr.whyPh")} onChange={(e) => setWhy(e.target.value)} />
                {who?.inClass ? (
                  <label className="setting">
                    <span><span>{t("aw.tg")}</span><br /><span className="small muted">{t("chr.tgHint")}</span></span>
                    <span className="switch"><input type="checkbox" checked={tg} onChange={(e) => setTg(e.target.checked)} /><span /></span>
                  </label>
                ) : who && <span className="small muted">{t("chr.offline")}</span>}
              </div>
            </div>
          )}
          {err && <div className="alert mt-2">{t("aw.err")}</div>}
          <div className="actions">
            <button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
            <button type="button" className="btn primary" disabled={busy || !pick || !sid || !name.trim() || (!!gendered && !gender)} onClick={give}>{t("chr.give")}</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
