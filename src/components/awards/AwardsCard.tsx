"use client";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { CATALOG, GROUPS, ICON_KEYS, METAL_KEYS, METALS, nameFor, type AwardKind, type CatalogItem } from "@/lib/awards/catalog";
import { deleteAward, giveAward, pinAward, setAwardMain } from "@/lib/awards/actions";
import { setStudentField } from "@/lib/teacher/actions";
import { useRun } from "../courses/useRun";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { Medal } from "./Medal";

export type AwardRow = { id: string; kind: string; name: string; why: string | null; icon: string; color: string; onMain: boolean; pinned: boolean; until: string | null; expired: boolean; date: string };

/** Анкета → «Статусы»: титулы (на главном экране или нет, главный) и поощрения; «Выдать статус». */
export function AwardsCard({ studentId, studentName, gender, rows, linked }: { studentId: string; studentName: string; gender: string | null; rows: AwardRow[]; linked: boolean }) {
  const { t } = useT();
  const { pending, run } = useRun();
  const [give, setGive] = useState(false);
  const titles = rows.filter((r) => r.kind === "title" && !r.expired);
  const cheers = rows.filter((r) => r.kind === "cheer");
  const past = rows.filter((r) => r.kind === "title" && r.expired);
  return (
    <section className="card sm">
      <div className="mb-3 flex items-center gap-2">
        <p className="cardtitle m-0">{t("aw.title")}</p>
        <button type="button" className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setGive(true)}><Icon name="plus" size="sm" />{t("aw.give")}</button>
      </div>
      {rows.length === 0 && <p className="hint m-0">{t("aw.none")}</p>}
      <div className="flex flex-col gap-2">
        {titles.map((a) => (
          <div key={a.id} className={`awrow ${a.pinned ? "pinned" : ""}`}>
            <Medal icon={a.icon} color={a.color} size={40} />
            <div className="grow min-w-0">
              <b className="block truncate">{a.name}</b>
              <span className="small muted">{a.date} · {a.until ? t("aw.until", { d: a.until }) : t("aw.forever")}</span>
            </div>
            {a.pinned ? <span className="pill orange">{t("aw.main")}</span> : a.onMain && <button type="button" className="btn plain sm" disabled={pending} onClick={() => run(() => pinAward(a.id))}>{t("aw.makeMain")}</button>}
            <label className="awmain" title={t("aw.onMainHint")}>
              <span className="small">{t("aw.onMain")}</span>
              <span className="switch"><input type="checkbox" checked={a.onMain} disabled={pending} onChange={(e) => run(() => setAwardMain(a.id, e.target.checked))} /><span /></span>
            </label>
            <button type="button" className="iconbtn" title={t("aw.remove")} aria-label={t("aw.remove")} disabled={pending} onClick={() => confirm(t("aw.removeQ", { n: a.name })) && run(() => deleteAward(a.id))}><Icon name="close" size="sm" /></button>
          </div>
        ))}
      </div>
      {(cheers.length > 0 || past.length > 0) && (
        <div className="awchips">
          <span className="small muted">{t("aw.collection")}</span>
          {[...cheers, ...past].slice(0, 12).map((a) => (
            <span key={a.id} className="awchip" title={a.why ?? a.name}>
              <Medal icon={a.icon} color={a.color} size={22} shape={a.kind === "cheer" ? "circle" : "hex"} muted={a.kind === "title"} />
              {a.name}
              <button type="button" aria-label={t("aw.remove")} onClick={() => confirm(t("aw.removeQ", { n: a.name })) && run(() => deleteAward(a.id))}>×</button>
            </span>
          ))}
        </div>
      )}
      {give && <GiveDialog studentId={studentId} studentName={studentName} gender={gender} linked={linked} onClose={() => setGive(false)} />}
    </section>
  );
}

function GiveDialog({ studentId, studentName, gender: g0, linked, onClose }: { studentId: string; studentName: string; gender: string | null; linked: boolean; onClose: () => void }) {
  const { t, lang } = useT();
  const { pending, error, run } = useRun();
  const [kind, setKind] = useState<AwardKind>("title");
  const [group, setGroup] = useState<string>("all");
  const [gender, setGender] = useState<string | null>(g0);
  const [pick, setPick] = useState<CatalogItem | null>(null);
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  const [icon, setIcon] = useState("crown");
  const [color, setColor] = useState("gold");
  const [term, setTerm] = useState<"week" | "month" | "date" | "forever">("month");
  const [until, setUntil] = useState("");
  const [onMain, setOnMain] = useState(true);
  const [tg, setTg] = useState(true);
  const L = lang === "en" ? "en" : "ru";
  const list = useMemo(() => CATALOG.filter((c) => c.kind === kind && (group === "all" || c.group === group)), [kind, group]);
  const choose = (c: CatalogItem | null) => {
    setPick(c);
    if (!c) { setName(""); setWhy(""); return; }
    setName(nameFor(c, L, gender)); setWhy(c.why[L]); setIcon(c.icon); setColor(c.color); setTerm(c.term);
  };
  // пол не указан, а у статуса две формы — выбираем здесь и запоминаем в анкете
  const gendered = pick && typeof pick.name.ru !== "string" && L === "ru";
  const setG = (v: "f" | "m") => { setGender(v); if (pick) setName(nameFor(pick, L, v)); void setStudentField(studentId, "gender", v); };
  const submit = () => run(() => giveAward(studentId, { kind, key: pick?.key ?? null, name, why, icon, color, term, until, onMain: kind === "title" && onMain, tg }), onClose);
  return (
    <Dialog open onClose={onClose} title={t("aw.giveTo", { n: studentName })} wide>
      <div className="awgive">
        <div className="flex flex-col gap-3 min-w-0">
          <div className="seg w-full">
            <button type="button" className="flex-1" aria-pressed={kind === "title"} onClick={() => { setKind("title"); setGroup("all"); choose(null); }}>{t("aw.kindTitle")}</button>
            <button type="button" className="flex-1" aria-pressed={kind === "cheer"} onClick={() => { setKind("cheer"); setGroup("all"); choose(null); }}>{t("aw.kindCheer")}</button>
          </div>
          <p className="hint m-0">{kind === "title" ? t("aw.kindTitleHint") : t("aw.kindCheerHint")}</p>
          <div className="chips">
            {[{ key: "all", ru: "Все", en: "All" }, ...GROUPS.filter((x) => x.kind === kind)].map((x) => (
              <label key={x.key} className="chip"><input type="radio" name="aw-g" checked={group === x.key} onChange={() => setGroup(x.key)} /><span>{x[L]}</span></label>
            ))}
          </div>
          <div className="awgrid">
            {list.map((c) => (
              <button key={c.key} type="button" className={`awcard ${pick?.key === c.key ? "on" : ""}`} onClick={() => choose(c)}>
                <Medal icon={c.icon} color={c.color} size={36} shape={kind === "title" ? "hex" : "circle"} />
                <b>{nameFor(c, L, gender)}</b>
              </button>
            ))}
            <button type="button" className={`awcard own ${!pick ? "on" : ""}`} onClick={() => choose(null)}>
              <span className="awplus"><Icon name="plus" /></span><b>{kind === "title" ? t("aw.ownTitle") : t("aw.ownCheer")}</b>
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 min-w-0">
          <div className="awpreview">
            <Medal icon={icon} color={color} size={76} shape={kind === "title" ? "hex" : "circle"} />
            <b style={{ color: METALS[color as keyof typeof METALS]?.text }}>{name || t("aw.namePh")}</b>
          </div>
          <div className="field">
            <label htmlFor="aw-name">{t("aw.name")}</label>
            <input id="aw-name" className="input" value={name} maxLength={80} placeholder={t("aw.namePh")} onChange={(e) => setName(e.target.value)} />
            {gendered && (
              <div className="seg mt-1 self-start">
                <button type="button" aria-pressed={gender === "f"} onClick={() => setG("f")}>{t("aw.she")}</button>
                <button type="button" aria-pressed={gender === "m"} onClick={() => setG("m")}>{t("aw.he")}</button>
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="aw-why">{t("aw.why")}</label>
            <textarea id="aw-why" className="textarea" rows={3} value={why} maxLength={500} placeholder={t("aw.whyPh")} onChange={(e) => setWhy(e.target.value)} />
          </div>
          <div className="field">
            <span className="flabel">{t("aw.icon")}</span>
            <div className="awicons">
              {ICON_KEYS.map((k) => (
                <button key={k} type="button" aria-pressed={icon === k} aria-label={k} onClick={() => setIcon(k)}><Medal icon={k} color={icon === k ? color : "silver"} size={30} shape={kind === "title" ? "hex" : "circle"} /></button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="flabel">{t("aw.color")}</span>
            <div className="flex flex-wrap gap-2">
              {METAL_KEYS.map((k) => (
                <button key={k} type="button" className={`awmetal ${color === k ? "on" : ""}`} aria-pressed={color === k} title={METALS[k][L]} aria-label={METALS[k][L]} onClick={() => setColor(k)} style={{ background: METALS[k].ring }} />
              ))}
            </div>
          </div>
          {kind === "title" && (
            <>
              <div className="field">
                <span className="flabel">{t("aw.term")}</span>
                <div className="seg w-full">
                  {(["week", "month", "date", "forever"] as const).map((k) => <button key={k} type="button" className="flex-1" aria-pressed={term === k} onClick={() => setTerm(k)}>{t(`aw.term.${k}` as "aw.term.week")}</button>)}
                </div>
                {term === "date" && <input type="date" className="input mt-2" value={until} onChange={(e) => setUntil(e.target.value)} aria-label={t("aw.term.date")} />}
                <span className="hint">{t("aw.termHint")}</span>
              </div>
              <label className="setting">
                <span><span>{t("aw.onMainLong")}</span><br /><span className="small muted">{t("aw.onMainHint")}</span></span>
                <span className="switch"><input type="checkbox" checked={onMain} onChange={(e) => setOnMain(e.target.checked)} /><span /></span>
              </label>
            </>
          )}
          <label className="setting">
            <span><span>{t("aw.tg")}</span>{!linked && <><br /><span className="small muted">{t("aw.tgOff")}</span></>}</span>
            <span className="switch"><input type="checkbox" checked={tg} onChange={(e) => setTg(e.target.checked)} /><span /></span>
          </label>
          {error && <div className="alert">{t("aw.err")}</div>}
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn primary" disabled={pending || !name.trim() || (kind === "title" && term === "date" && !until)} onClick={submit}>{t("aw.giveBtn")}</button>
      </div>
    </Dialog>
  );
}
