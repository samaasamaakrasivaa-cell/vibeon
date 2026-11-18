"use client";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { GROUPS, ICON_KEYS, METAL_KEYS, METALS, nameFor, whyFor, type AwardKind, type CatalogItem } from "@/lib/awards/catalog";
import { PhraseLangSwitch, usePhraseLang, type PL } from "./PhraseLang";
import { deleteAward, deleteTemplate, giveAward, pinAward, setAwardMain, updateAward, updateTemplate } from "@/lib/awards/actions";
import { setStudentField } from "@/lib/teacher/actions";
import { useRun } from "../courses/useRun";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { Medal } from "./Medal";

export type AwardRow = { id: string; kind: string; name: string; why: string | null; icon: string; color: string; onMain: boolean; pinned: boolean; until: string | null; untilIso: string | null; expired: boolean; date: string };
/** Свой статус учителя из картотеки «Мои». */
export type AwardTpl = { id: string; kind: string; name: string; why: string | null; icon: string; color: string; term: string; nameRu: string | null; nameEn: string | null; whyRu: string | null; whyEn: string | null };
/** Свой статус на нужном языке фразы (если перевода ещё нет — как написан). */
const tplName = (x: AwardTpl, pl: string) => (pl === "en" ? x.nameEn ?? x.nameRu : x.nameRu ?? x.nameEn) ?? x.name;
const tplWhy = (x: AwardTpl, pl: string) => (pl === "en" ? x.whyEn ?? x.whyRu : x.whyRu ?? x.whyEn) ?? x.why ?? "";

/** Анкета → «Статусы»: титулы (на главном экране или нет, главный) и поощрения; «Выдать статус». */
export function AwardsCard({ studentId, studentName, gender, rows, linked, templates, preset = null, catalog, owner = false }: { studentId: string; studentName: string; gender: string | null; rows: AwardRow[]; linked: boolean; templates: AwardTpl[]; preset?: { key: string; name?: string } | null; catalog: CatalogItem[]; owner?: boolean }) {
  const { t } = useT();
  const { pending, run } = useRun();
  const [give, setGive] = useState(!!preset); // пришли по «Выдать награду» — окно сразу открыто
  const [edit, setEdit] = useState<AwardRow | null>(null);
  const titles = rows.filter((r) => r.kind === "title" && !r.expired);
  const cheers = rows.filter((r) => r.kind === "cheer");
  const past = rows.filter((r) => r.kind === "title" && r.expired);
  return (
    <section className="card sm" id="awards">
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
            <button type="button" className="iconbtn" title={t("aw.edit")} aria-label={t("aw.edit")} disabled={pending} onClick={() => setEdit(a)}><Icon name="pencil" size="sm" /></button>
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
              <button type="button" className="awchip-name" title={t("aw.edit")} onClick={() => setEdit(a)}>{a.name}</button>
              <button type="button" aria-label={t("aw.remove")} onClick={() => confirm(t("aw.removeQ", { n: a.name })) && run(() => deleteAward(a.id))}>×</button>
            </span>
          ))}
        </div>
      )}
      {give && <GiveDialog studentId={studentId} studentName={studentName} gender={gender} linked={linked} templates={templates} preset={preset} catalog={catalog} owner={owner} onClose={() => setGive(false)} />}
      {edit && <EditDialog a={edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function GiveDialog({ studentId, studentName, gender: g0, linked, templates, preset = null, catalog: CATALOG, owner, onClose }: { studentId: string; studentName: string; gender: string | null; linked: boolean; templates: AwardTpl[]; preset?: { key: string; name?: string } | null; catalog: CatalogItem[]; owner: boolean; onClose: () => void }) {
  const { t, lang } = useT();
  const { pending, error, run } = useRun();
  const [kind, setKind] = useState<AwardKind>("title");
  const [group, setGroup] = useState<string>("all");
  const [gender, setGender] = useState<string | null>(g0);
  const [pick, setPick] = useState<CatalogItem | null>(null);
  const [mineList, setMineList] = useState(templates);
  const [tpl, setTpl] = useState<AwardTpl | null>(null);
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  const [icon, setIcon] = useState("crown");
  const [color, setColor] = useState("gold");
  const [term, setTerm] = useState<"week" | "month" | "date" | "forever">("month");
  const [until, setUntil] = useState("");
  const [onMain, setOnMain] = useState(true);
  const [tg, setTg] = useState(true);
  const L = lang === "en" ? "en" : "ru"; // язык интерфейса — для групп
  const [pl, setPl] = usePhraseLang(); // язык самой фразы — выбирает учитель
  const list = useMemo(() => (group === "mine" ? [] : CATALOG.filter((c) => c.kind === kind && (group === "all" || c.group === group))), [kind, group]);
  const mine = mineList.filter((x) => x.kind === kind && (group === "all" || group === "mine"));
  const chooseTpl = (x: AwardTpl) => {
    setPick(null); setTpl(x);
    setName(tplName(x, pl)); setWhy(tplWhy(x, pl)); setIcon(x.icon); setColor(x.color);
    if (["week", "month", "date", "forever"].includes(x.term)) setTerm(x.term as "month");
  };
  const dropTpl = (x: AwardTpl) => { if (!confirm(t("aw.tplDelQ", { n: x.name }))) return; setMineList((l) => l.filter((y) => y.id !== x.id)); if (tpl?.id === x.id) setTpl(null); void deleteTemplate(x.id); };
  const choose = (c: CatalogItem | null) => {
    setPick(c); setTpl(null);
    if (!c) { setName(""); setWhy(""); return; }
    setName(nameFor(c, pl, gender)); setWhy(whyFor(c, pl, gender)); setIcon(c.icon); setColor(c.color); setTerm(c.term);
  };
  const switchLang = (v: PL) => { setPl(v); if (pick) { setName(nameFor(pick, v, gender)); setWhy(whyFor(pick, v, gender)); } if (tpl) { setName(tplName(tpl, v)); setWhy(tplWhy(tpl, v)); } };
  const [editTpl, setEditTpl] = useState<AwardTpl | null>(null);
  // пол не указан, а у статуса две формы — выбираем здесь и запоминаем в анкете
  const gendered = pick && pl === "ru" && (typeof pick.name.ru !== "string" || /\(а\)/.test(pick.name.ru + pick.why.ru));
  const setG = (v: "f" | "m") => { setGender(v); if (pick) { setName(nameFor(pick, pl, v)); setWhy(whyFor(pick, pl, v)); } void setStudentField(studentId, "gender", v); };
  // подсказанная награда: выбрать её в каталоге и подставить название (например, «50 уроков вместе»)
  useEffect(() => {
    const c = preset ? CATALOG.find((x) => x.key === preset.key) : null;
    if (!c) return;
    setKind(c.kind); setGroup("all"); choose(c);
    if (preset?.name) setName(preset.name);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => run(() => giveAward(studentId, { kind, key: pick?.key ?? null, name, why, icon, color, term, until, onMain: kind === "title" && onMain, tg, tplId: tpl?.id ?? null }), onClose);
  return (
    <Dialog open onClose={onClose} title={t("aw.giveTo", { n: studentName })} wide>
      {editTpl && <TplEdit x={editTpl} onClose={(u) => { if (u) { setMineList((l) => l.map((y) => (y.id === u.id ? u : y))); if (tpl?.id === u.id) { setTpl(u); setName(tplName(u, pl)); setWhy(tplWhy(u, pl)); } } setEditTpl(null); }} />}
      <div className="awgive">
        <div className="flex flex-col gap-3 min-w-0">
          <div className="seg w-full">
            <button type="button" className="flex-1" aria-pressed={kind === "title"} onClick={() => { setKind("title"); setGroup("all"); choose(null); }}>{t("aw.kindTitle")}</button>
            <button type="button" className="flex-1" aria-pressed={kind === "cheer"} onClick={() => { setKind("cheer"); setGroup("all"); choose(null); }}>{t("aw.kindCheer")}</button>
          </div>
          <p className="hint m-0">{kind === "title" ? t("aw.kindTitleHint") : t("aw.kindCheerHint")} {t("aw.mineSaved")}</p>
          <PhraseLangSwitch value={pl} onChange={switchLang} />
          <div className="chips">
            {[{ key: "all", ru: "Все", en: "All" }, ...(mineList.some((x) => x.kind === kind) ? [{ key: "mine", ru: "Мои", en: "Mine" }] : []), ...GROUPS.filter((x) => x.kind === kind)].map((x) => (
              <label key={x.key} className="chip"><input type="radio" name="aw-g" checked={group === x.key} onChange={() => setGroup(x.key)} /><span>{x[L]}</span></label>
            ))}
          </div>
          <div className="awgrid">
            {mine.map((x) => (
              <div key={x.id} className={`awcard mine ${tpl?.id === x.id ? "on" : ""}`}>
                <button type="button" className="awcard-pick" onClick={() => chooseTpl(x)}>
                  <Medal icon={x.icon} color={x.color} size={36} shape={kind === "title" ? "hex" : "circle"} />
                  <b>{tplName(x, pl)}<span className="awmine-tag">{t("aw.mineTag")}</span></b>
                </button>
                <button type="button" className="awcard-x" aria-label={t("aw.tplDel")} title={t("aw.tplDel")} onClick={() => dropTpl(x)}>×</button>
                <button type="button" className="awcard-ed" aria-label={t("aw.tplEdit")} title={t("aw.tplEdit")} onClick={() => setEditTpl(x)}><Icon name="pencil" size="sm" /></button>
              </div>
            ))}
            {list.map((c) => (
              <button key={c.key} type="button" className={`awcard ${pick?.key === c.key ? "on" : ""}`} onClick={() => choose(c)}>
                <Medal icon={c.icon} color={c.color} size={36} shape={kind === "title" ? "hex" : "circle"} />
                <b>{nameFor(c, pl, gender)}</b>
              </button>
            ))}
            <button type="button" className={`awcard own ${!pick && !tpl ? "on" : ""}`} onClick={() => choose(null)}>
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
            <span><span>{t("aw.tg")}</span><br /><span className="small muted">{linked ? t("aw.tgNight") : t("aw.tgOff")}</span></span>
            <span className="switch"><input type="checkbox" checked={tg} onChange={(e) => setTg(e.target.checked)} /><span /></span>
          </label>
          {error && <div className="alert">{t("aw.err")}</div>}
        </div>
      </div>
      <div className="actions">
        {owner && <a href="/teacher/awards" className="btn plain" style={{ marginRight: "auto" }}><Icon name="pencil" size="sm" />{t("cat.edit")}</a>}
        <button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn primary" disabled={pending || !name.trim() || (kind === "title" && term === "date" && !until)} onClick={submit}>{t("aw.giveBtn")}</button>
      </div>
    </Dialog>
  );
}

/** Изменить выданный статус: название, «за что», значок, металл; у титула — срок. */
function EditDialog({ a, onClose }: { a: AwardRow; onClose: () => void }) {
  const { t, lang } = useT();
  const { pending, error, run } = useRun();
  const L = lang === "en" ? "en" : "ru";
  const [name, setName] = useState(a.name);
  const [why, setWhy] = useState(a.why ?? "");
  const [icon, setIcon] = useState(a.icon);
  const [color, setColor] = useState(a.color);
  const [forever, setForever] = useState(!a.untilIso);
  const [until, setUntil] = useState(a.untilIso ?? "");
  const title = a.kind === "title";
  const shape = title ? "hex" : "circle";
  return (
    <Dialog open onClose={onClose} title={t("aw.editTitle")}>
      <div className="awpreview mb-3">
        <Medal icon={icon} color={color} size={68} shape={shape} />
        <b style={{ color: METALS[color as keyof typeof METALS]?.text }}>{name || t("aw.namePh")}</b>
      </div>
      <div className="field"><label htmlFor="awe-name">{t("aw.name")}</label><input id="awe-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field mt-3"><label htmlFor="awe-why">{t("aw.why")}</label><textarea id="awe-why" className="textarea" rows={3} value={why} maxLength={500} placeholder={t("aw.whyPh")} onChange={(e) => setWhy(e.target.value)} /></div>
      <div className="field mt-3"><span className="flabel">{t("aw.icon")}</span>
        <div className="awicons">{ICON_KEYS.map((k) => <button key={k} type="button" aria-pressed={icon === k} aria-label={k} onClick={() => setIcon(k)}><Medal icon={k} color={icon === k ? color : "silver"} size={28} shape={shape} /></button>)}</div>
      </div>
      <div className="field mt-3"><span className="flabel">{t("aw.color")}</span>
        <div className="flex flex-wrap gap-2">{METAL_KEYS.map((k) => <button key={k} type="button" className={`awmetal ${color === k ? "on" : ""}`} aria-pressed={color === k} title={METALS[k][L]} aria-label={METALS[k][L]} onClick={() => setColor(k)} style={{ background: METALS[k].ring }} />)}</div>
      </div>
      {title && (
        <div className="field mt-3"><span className="flabel">{t("aw.term")}</span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2"><span className="switch"><input type="checkbox" checked={forever} onChange={(e) => setForever(e.target.checked)} /><span /></span><span>{t("aw.term.forever")}</span></label>
            {!forever && <input type="date" className="input" style={{ width: 180 }} value={until} onChange={(e) => setUntil(e.target.value)} aria-label={t("aw.term.date")} />}
          </div>
        </div>
      )}
      {error && <div className="alert mt-3">{t("aw.err")}</div>}
      <div className="actions">
        <button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn primary" disabled={pending || !name.trim() || (title && !forever && !until)} onClick={() => run(() => updateAward(a.id, { name, why, icon, color, ...(title ? { until: forever ? null : until } : {}) }), onClose)}>{t("common.save")}</button>
      </div>
    </Dialog>
  );
}

/** Свой статус: название и «за что» на русском и английском (английский или русский перевёл ИИ — здесь можно поправить). */
function TplEdit({ x, onClose }: { x: AwardTpl; onClose: (u?: AwardTpl) => void }) {
  const { t } = useT();
  const { pending, error, run } = useRun();
  const [f, setF] = useState({ nameRu: x.nameRu ?? "", nameEn: x.nameEn ?? "", whyRu: x.whyRu ?? "", whyEn: x.whyEn ?? "" });
  return (
    <Dialog open onClose={() => onClose()} title={t("aw.tplEdit")}>
      <p className="hint mt-0">{t("aw.tplEditHint")}</p>
      <div className="field"><label htmlFor="te-nr">{t("cat.nameRu")}</label><input id="te-nr" className="input" value={f.nameRu} maxLength={80} onChange={(e) => setF({ ...f, nameRu: e.target.value })} /></div>
      <div className="field mt-3"><label htmlFor="te-wr">{t("cat.whyRu")}</label><textarea id="te-wr" className="textarea" rows={2} value={f.whyRu} maxLength={500} onChange={(e) => setF({ ...f, whyRu: e.target.value })} /></div>
      <div className="field mt-3"><label htmlFor="te-ne">{t("cat.nameEn")}</label><input id="te-ne" className="input" value={f.nameEn} maxLength={80} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></div>
      <div className="field mt-3"><label htmlFor="te-we">{t("cat.whyEn")}</label><textarea id="te-we" className="textarea" rows={2} value={f.whyEn} maxLength={500} onChange={(e) => setF({ ...f, whyEn: e.target.value })} /></div>
      {error && <div className="alert mt-2">{t("aw.err")}</div>}
      <div className="actions">
        <button type="button" className="btn secondary" onClick={() => onClose()}>{t("common.cancel")}</button>
        <button type="button" className="btn primary" disabled={pending || (!f.nameRu.trim() && !f.nameEn.trim())} onClick={() => run(() => updateTemplate(x.id, f), () => onClose({ ...x, nameRu: f.nameRu.trim() || null, nameEn: f.nameEn.trim() || null, whyRu: f.whyRu.trim() || null, whyEn: f.whyEn.trim() || null }))}>{t("common.save")}</button>
      </div>
    </Dialog>
  );
}
