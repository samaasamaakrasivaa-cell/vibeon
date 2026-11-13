"use client";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { GROUPS, TYPES, type TaskType } from "@/lib/tasks/catalog";
import { thumbSvg } from "@/lib/tasks/thumbs";
import { setFavourites } from "@/lib/teacher/courses";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";

/** Каталог типов заданий с картинками-превью: добавление задания и «Сменить тип задания» (mark — подходит без потери содержания, current — текущий тип). */
export function Catalog({ fav: initialFav, onPick, onClose, onImport, title, mark, current, hint }: { fav: string[]; onPick: (t: TaskType) => void; onClose: () => void; onImport?: () => void; title?: string; mark?: (t: TaskType) => boolean; current?: TaskType; hint?: string }) {
  const { t, lang } = useT();
  const [q, setQ] = useState("");
  const [fav, setFav] = useState(initialFav);
  const name = (k: TaskType) => (lang === "en" ? TYPES[k].en : TYPES[k].ru);
  const all = (Object.keys(TYPES) as TaskType[]).filter((k) => TYPES[k].g !== "tech" || k === "divider");
  const match = useMemo(() => all.filter((k) => !q || name(k).toLowerCase().includes(q.toLowerCase()) || TYPES[k].en.toLowerCase().includes(q.toLowerCase())), [q, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: string) => { const n = fav.includes(k) ? fav.filter((x) => x !== k) : [...fav, k]; setFav(n); setFavourites(n); };
  const card = (k: TaskType) => (
    <button key={k} type="button" className={`catcard ${k === current ? "cur" : ""} ${mark?.(k) ? "fit" : ""}`} onClick={() => onPick(k)} aria-current={k === current || undefined}>
      {mark?.(k) && <span className="catfit" title={t("bld.retypeFit")}>✓</span>}
      <span className="heart" role="button" aria-label={t("bld.fav")} onClick={(e) => { e.stopPropagation(); toggle(k); }}>{fav.includes(k) ? "♥" : "♡"}</span>
      <span className="thumbw" dangerouslySetInnerHTML={{ __html: thumbSvg(k) }} />
      <b>{name(k)}</b>
    </button>
  );
  return (
    <Dialog open onClose={onClose} title={title ?? t("bld.createTask")} wide>
      {hint && <p className="small muted mt-0">{hint}</p>}
      {onImport && <button type="button" className="aiattach w-full text-left" onClick={onImport}><Icon name="spark" /><span className="grow"><b>{t("bld.attach")}</b><small>{t("bld.attachSub")}</small></span></button>}
      <label className="searchbox my-4 block"><Icon name="search" size="sm" /><input className="input w-full" placeholder={t("bld.searchTasks")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label>
      <div className="catscroll">
        {!q && fav.length > 0 && <><div className="cardtitle">♡ {t("bld.favourites")}</div><div className="catgrid">{fav.filter((k) => k in TYPES).map((k) => card(k as TaskType))}</div></>}
        {GROUPS.map(([g, en, ru]) => {
          const items = match.filter((k) => TYPES[k].g === g);
          return items.length ? <div key={g}><div className="cardtitle mt-4">{lang === "en" ? en : ru}</div><div className="catgrid">{items.map(card)}</div></div> : null;
        })}
        {match.includes("divider") && <div><div className="cardtitle mt-4">{t("bld.other")}</div><div className="catgrid">{card("divider")}</div></div>}
      </div>
    </Dialog>
  );
}
