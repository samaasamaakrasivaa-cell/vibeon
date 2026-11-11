"use client";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { Icon } from "../Icon";
import type { IconName } from "../icon-paths";

const STEPS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1"];
// пример: разминка A1–A2 → поиск: B1 ✓ → B2 ✗ → подробная проверка B1 (простые и сложные задания по группам)
const PATH = [0, 2, 2, 4, 4, 4, 6, 6, 6, 4, 5, 5, 4, 5, 5, 4, 5, 5];
const OK = [1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1];

/** «Как устроен тест» — коротко и тезисами: как ищет уровень, что внутри, как читать результат, почему ему можно доверять. */
export function PlacementAbout() {
  const { t } = useT();
  const W = 560, H = 190, x0 = 40, dx = (W - x0 - 10) / (PATH.length - 1), y = (s: number) => H - 22 - s * ((H - 40) / 8);
  const steps: [IconName, DictKey, DictKey][] = [["spark", "pl.ab2.s1", "pl.ab2.s1t"], ["route", "pl.ab2.s2", "pl.ab2.s2t"], ["target", "pl.ab2.s3", "pl.ab2.s3t"]];
  const parts: [IconName, DictKey][] = [["book", "pl.ab2.p.core"], ["cards", "pl.ab2.p.vocab"], ["note", "pl.ab2.p.texts"], ["pencil", "pl.ab2.p.ws"]];
  const list = (title: DictKey, keys: DictKey[]) => (
    <div className="plabtips">
      <b>{t(title)}</b>
      {keys.map((k) => <div key={k} className="plpoint"><span className="pldotc" />{t(k)}</div>)}
    </div>
  );
  return (
    <div className="plabout">
      <div className="plabsec">
        <b>{t("pl.ab2.how")}</b>
        <div className="plsteps3">
          {steps.map(([ic, h, x], i) => (
            <div key={h} className="plpart"><span className="plico sm"><Icon name={ic} size="sm" /></span><div><b>{i + 1}. {t(h)}</b><div className="small muted">{t(x)}</div></div></div>
          ))}
        </div>
      </div>
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
      <div className="plabsec">
        <b>{t("pl.ab2.parts")}</b>
        <div className="flex flex-col gap-2">
          {parts.map(([ic, k]) => { const [head, ...rest] = t(k).split(" — "); return (
            <div key={k} className="plabpart"><span className="plico sm"><Icon name={ic} size="sm" /></span><div><b>{head}</b><div className="small muted">{((r) => r.charAt(0).toUpperCase() + r.slice(1))(rest.join(" — "))}</div></div></div>
          ); })}
        </div>
      </div>
      {list("pl.ab2.read", ["pl.ab2.r1", "pl.ab2.r2", "pl.ab2.r3", "pl.ab2.r4"])}
      {list("pl.ab2.why", ["pl.ab2.w1", "pl.ab2.w2", "pl.ab2.w3", "pl.ab2.w4"])}
      {list("pl.ab2.tips", ["pl.ab2.t1", "pl.ab2.t2", "pl.ab2.t3", "pl.ab2.t4"])}
    </div>
  );
}
