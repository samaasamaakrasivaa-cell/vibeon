"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { GROUPS, ICON_KEYS, METAL_KEYS, METALS, type AwardKind, type CatalogItem } from "@/lib/awards/catalog";
import { resetCatalogItem, saveCatalogItem, type CatalogInput } from "@/lib/awards/catalog-actions";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { Medal } from "./Medal";

type Item = CatalogItem & { hidden?: boolean; edited?: boolean; custom?: boolean };

/** Владелец платформы: каталог статусов по группам — изменить, скрыть, вернуть как было, добавить новый. */
export function CatalogEditor({ items }: { items: Item[] }) {
  const { t, lang } = useT();
  const L = lang === "en" ? "en" : "ru";
  const [kind, setKind] = useState<AwardKind>("title");
  const [edit, setEdit] = useState<Item | "new" | null>(null);
  const ruName = (c: Item) => (typeof c.name.ru === "string" ? c.name.ru : `${c.name.ru.f} / ${c.name.ru.m}`);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="seg">
          <button type="button" aria-pressed={kind === "title"} onClick={() => setKind("title")}>{t("aw.kindTitle")}</button>
          <button type="button" aria-pressed={kind === "cheer"} onClick={() => setKind("cheer")}>{t("aw.kindCheer")}</button>
        </div>
        <button type="button" className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setEdit("new")}><Icon name="plus" size="sm" />{t("cat.add")}</button>
      </div>
      {GROUPS.filter((g) => g.kind === kind).map((g) => {
        const list = items.filter((c) => c.kind === kind && c.group === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key} className="card">
            <h2 className="mb-3">{g[L]}</h2>
            <div className="catlist">
              {list.map((c) => (
                <button key={c.key} type="button" className={`catitem ${c.hidden ? "off" : ""}`} onClick={() => setEdit(c)}>
                  <Medal icon={c.icon} color={c.color} size={40} shape={kind === "title" ? "hex" : "circle"} muted={c.hidden} />
                  <span className="grow min-w-0">
                    <b className="block">{ruName(c)}</b>
                    <span className="small muted block">{c.why.ru}</span>
                    <span className="small muted block">EN: {c.name.en}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {c.hidden && <span className="pill grey">{t("cat.hidden")}</span>}
                    {c.custom ? <span className="pill violet">{t("cat.new")}</span> : c.edited && <span className="pill blue">{t("cat.edited")}</span>}
                    <Icon name="pencil" size="sm" className="text-text3" />
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {edit && <ItemDialog item={edit === "new" ? null : edit} kind={kind} onClose={() => setEdit(null)} />}
    </>
  );
}

function ItemDialog({ item, kind: k0, onClose }: { item: Item | null; kind: AwardKind; onClose: () => void }) {
  const { t, lang } = useT();
  const router = useRouter();
  const L = lang === "en" ? "en" : "ru";
  const kind = item?.kind ?? k0;
  const n = item?.name.ru;
  const [f, setF] = useState<CatalogInput>({
    key: item?.key ?? null, kind, group: item?.group ?? GROUPS.find((g) => g.kind === kind)!.key,
    nameRu: typeof n === "string" ? n : n?.f ?? "", nameRuM: typeof n === "object" ? n.m : "", nameEn: item?.name.en ?? "",
    whyRu: item?.why.ru ?? "", whyEn: item?.why.en ?? "", icon: item?.icon ?? "star", color: item?.color ?? "gold", term: item?.term ?? (kind === "title" ? "month" : "forever"), hidden: !!item?.hidden,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const shape = kind === "title" ? "hex" : "circle";
  const run = async (fn: () => Promise<{ ok: boolean }>) => { setBusy(true); setErr(false); const r = await fn().catch(() => ({ ok: false })); setBusy(false); if (!r.ok) return setErr(true); onClose(); router.refresh(); };
  return (
    <Dialog open onClose={onClose} title={item ? t("cat.editTitle") : t("cat.add")} wide>
      <div className="awpreview mb-3">
        <Medal icon={f.icon} color={f.color} size={68} shape={shape} muted={f.hidden} />
        <b style={{ color: METALS[f.color as keyof typeof METALS]?.text }}>{f.nameRu || t("aw.namePh")}{f.nameRuM ? ` / ${f.nameRuM}` : ""}</b>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field"><label htmlFor="ci-nr">{t("cat.nameRu")}</label><input id="ci-nr" className="input" value={f.nameRu} maxLength={80} onChange={(e) => setF({ ...f, nameRu: e.target.value })} /></div>
        <div className="field"><label htmlFor="ci-nm">{t("cat.nameRuM")}</label><input id="ci-nm" className="input" value={f.nameRuM} maxLength={80} placeholder={t("cat.nameRuMPh")} onChange={(e) => setF({ ...f, nameRuM: e.target.value })} /></div>
        <div className="field sm:col-span-2"><label htmlFor="ci-ne">{t("cat.nameEn")}</label><input id="ci-ne" className="input" value={f.nameEn} maxLength={80} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></div>
        <div className="field"><label htmlFor="ci-wr">{t("cat.whyRu")}</label><textarea id="ci-wr" className="textarea" rows={3} value={f.whyRu} maxLength={500} placeholder={t("cat.whyHint")} onChange={(e) => setF({ ...f, whyRu: e.target.value })} /></div>
        <div className="field"><label htmlFor="ci-we">{t("cat.whyEn")}</label><textarea id="ci-we" className="textarea" rows={3} value={f.whyEn} maxLength={500} onChange={(e) => setF({ ...f, whyEn: e.target.value })} /></div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="field"><label htmlFor="ci-g">{t("cat.group")}</label>
          <select id="ci-g" className="select" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>{GROUPS.filter((g) => g.kind === kind).map((g) => <option key={g.key} value={g.key}>{g[L]}</option>)}</select></div>
        {kind === "title" && <div className="field"><label htmlFor="ci-t">{t("aw.term")}</label>
          <select id="ci-t" className="select" value={f.term} onChange={(e) => setF({ ...f, term: e.target.value as CatalogInput["term"] })}>{(["week", "month", "forever"] as const).map((x) => <option key={x} value={x}>{t(`aw.term.${x}` as "aw.term.week")}</option>)}</select></div>}
      </div>
      <div className="field mt-3"><span className="flabel">{t("aw.icon")}</span>
        <div className="awicons">{ICON_KEYS.map((k) => <button key={k} type="button" aria-pressed={f.icon === k} aria-label={k} onClick={() => setF({ ...f, icon: k })}><Medal icon={k} color={f.icon === k ? f.color : "silver"} size={28} shape={shape} /></button>)}</div>
      </div>
      <div className="field mt-3"><span className="flabel">{t("aw.color")}</span>
        <div className="flex flex-wrap gap-2">{METAL_KEYS.map((k) => <button key={k} type="button" className={`awmetal ${f.color === k ? "on" : ""}`} aria-pressed={f.color === k} title={METALS[k][L]} aria-label={METALS[k][L]} onClick={() => setF({ ...f, color: k })} style={{ background: METALS[k].ring }} />)}</div>
      </div>
      <label className="setting mt-2"><span>{t("cat.hide")}<br /><span className="small muted">{t("cat.hideHint")}</span></span><span className="switch"><input type="checkbox" checked={f.hidden} onChange={(e) => setF({ ...f, hidden: e.target.checked })} /><span /></span></label>
      {err && <div className="alert mt-2">{t("aw.err")}</div>}
      <div className="actions">
        {item && (item.edited || item.custom) && <button type="button" className="btn plain text-bad" style={{ marginRight: "auto" }} disabled={busy} onClick={() => confirm(item.custom ? t("cat.delQ") : t("cat.resetQ")) && run(() => resetCatalogItem(item.key))}>{item.custom ? t("common.delete") : t("cat.reset")}</button>}
        <button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn primary" disabled={busy || !f.nameRu.trim()} onClick={() => run(() => saveCatalogItem(f))}>{t("common.save")}</button>
      </div>
    </Dialog>
  );
}
