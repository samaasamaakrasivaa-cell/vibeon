"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { AIM_KEYS, hasInfo, type TInfo } from "@/lib/tasks/teacher-info";
import { Icon } from "../Icon";

/** Только для учителя: на уроке — для чтения; в конструкторе — с правкой (onSave). Ученик этот блок не получает. */
export function TeacherInfo({ info, onSave, open: open0 = false }: { info: TInfo; onSave?: (x: TInfo) => void; open?: boolean }) {
  const { t } = useT();
  const [v, setV] = useState<TInfo>(info);
  const [edit, setEdit] = useState(false);
  if (!onSave && !hasInfo(info)) return null;
  const set = (patch: TInfo) => setV((x) => ({ ...x, ...patch }));
  const setAim = (k: (typeof AIM_KEYS)[number], val: string) => setV((x) => ({ ...x, aims: { ...(x.aims ?? {}), [k]: val } }));
  const save = () => { onSave?.(v); setEdit(false); };
  const row = (label: string, text?: string) => text ? <div className="tinfo-row"><b>{label}</b><div className="tinfo-t">{text}</div></div> : null;
  return (
    <details className="tinfo" open={open0 || edit}>
      <summary><span className="tinfo-ic"><Icon name="lock" size="sm" /></span><b className="grow">{t("ti.title")}</b><Icon name="chevd" size="sm" className="tinfo-chev" /></summary>
      <p className="tinfo-note">{t("ti.only")}</p>
      {!edit ? (
        <div className="tinfo-body">
          {!hasInfo(v) && <p className="small muted m-0">{t("ti.empty")}</p>}
          {row(t("ti.level"), v.level)}
          {row(t("ti.info"), v.info)}
          {v.aims && Object.values(v.aims).some(Boolean) && (
            <div className="tinfo-row"><b>{t("ti.aims")}</b>
              <ul className="tinfo-aims">{AIM_KEYS.filter((k) => v.aims?.[k]).map((k) => <li key={k}><span className="pill violet">{t(`ti.aim.${k}` as DictKey)}</span> {v.aims![k]}</li>)}</ul>
            </div>
          )}
          {row(t("ti.overview"), v.overview)}
          {row(t("ti.notes"), v.notes)}
          {onSave && <button type="button" className="btn secondary sm self-start" onClick={() => setEdit(true)}><Icon name="pencil" size="sm" />{t("ti.edit")}</button>}
        </div>
      ) : (
        <div className="tinfo-body">
          <label className="field"><span className="small">{t("ti.level")}</span><input className="input" value={v.level ?? ""} onChange={(e) => set({ level: e.target.value })} placeholder="B1" /></label>
          <label className="field"><span className="small">{t("ti.info")}</span><textarea className="textarea" rows={3} value={v.info ?? ""} onChange={(e) => set({ info: e.target.value })} placeholder={t("ti.infoPh")} /></label>
          <div className="small font-bold">{t("ti.aims")}</div>
          {AIM_KEYS.map((k) => <label key={k} className="field"><span className="small">{t(`ti.aim.${k}` as DictKey)}</span><textarea className="textarea" rows={2} value={v.aims?.[k] ?? ""} onChange={(e) => setAim(k, e.target.value)} /></label>)}
          <label className="field"><span className="small">{t("ti.overview")}</span><textarea className="textarea" rows={5} value={v.overview ?? ""} onChange={(e) => set({ overview: e.target.value })} placeholder={t("ti.overviewPh")} /></label>
          <label className="field"><span className="small">{t("ti.notes")}</span><textarea className="textarea" rows={3} value={v.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} /></label>
          <div className="flex gap-2"><button type="button" className="btn primary sm" onClick={save}>{t("common.save")}</button><button type="button" className="btn plain sm" onClick={() => { setV(info); setEdit(false); }}>{t("common.cancel")}</button></div>
        </div>
      )}
    </details>
  );
}
