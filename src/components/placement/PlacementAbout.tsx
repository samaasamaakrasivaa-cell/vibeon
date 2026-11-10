"use client";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { Icon } from "../Icon";
import type { IconName } from "../icon-paths";

const STEPS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1"];
// пример: разминка A1–A2 → поиск: B1 ✓ → B2 ✗ → подробная проверка B1 (простые и сложные задания по группам)
const PATH = [0, 2, 2, 4, 4, 4, 6, 6, 6, 4, 5, 5, 4, 5, 5, 4, 5, 5];
const OK = [1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1];

/** «Как устроен тест» — подробно для учителя: этапы, как оценивается, что вы получите. */
export function PlacementAbout() {
  const { t } = useT();
  const W = 560, H = 190, x0 = 40, dx = (W - x0 - 10) / (PATH.length - 1), y = (s: number) => H - 22 - s * ((H - 40) / 8);
  const stages: [IconName, DictKey, DictKey][] = [
    ["sound", "pl.st1", "pl.st1t"], ["book", "pl.st2", "pl.st2t"], ["cards", "pl.st3", "pl.st3t"],
    ["note", "pl.st4", "pl.st4t"], ["pencil", "pl.st5", "pl.st5t"], ["route", "pl.st6", "pl.st6t"],
  ];
  return (
    <div className="plabout">
      <ol className="pltimeline">
        {stages.map(([ic, h, x], i) => (
          <li key={h}><span className="pltl-ico"><Icon name={ic} size="sm" /></span><div><b>{i + 1}. {t(h)}</b><p>{t(x)}</p></div></li>
        ))}
      </ol>
      <div className="plladder">
        <div className="small font-semibold mb-1">{t("pl.ab.ladder")}</div>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("pl.ab.ladder")}>
          {STEPS.map((s, i) => <g key={s}><line x1={x0} x2={W - 6} y1={y(i)} y2={y(i)} className="grid" /><text x={x0 - 8} y={y(i) + 4} textAnchor="end" className="lab">{s}</text></g>)}
          <rect x={x0 - 4} y={y(2) - 8} width={dx * 2 + 8} height={y(0) - y(2) + 16} rx="8" className="warm" />
          <polyline points={PATH.map((s, i) => `${x0 + i * dx},${y(s)}`).join(" ")} className="path" />
          {PATH.map((s, i) => <circle key={i} cx={x0 + i * dx} cy={y(s)} r="5" className={OK[i] ? "ok" : "bad"} />)}
          <text x={x0 + dx} y={y(0) + 18} textAnchor="middle" className="note">{t("pl.ab.warm")}</text>
          <text x={x0 + (PATH.length - 1) * dx - 6} y={y(6) - 6} textAnchor="end" className="note b">{t("pl.ab.result")}</text>
        </svg>
        <div className="pllegend small muted"><span><i className="ok" />{t("pl.ab.right")}</span><span><i className="bad" />{t("pl.ab.wrong")}</span><span>{t("pl.ab.ladderHint")}</span></div>
      </div>
      <div className="plabtips">
        <b>{t("pl.ab.tips")}</b>
        {(["pl.ab.tip1", "pl.ab.tip2", "pl.ab.tip3", "pl.ab.tip4"] as DictKey[]).map((k) => <div key={k} className="plpoint"><span className="pldotc" />{t(k)}</div>)}
      </div>
    </div>
  );
}
