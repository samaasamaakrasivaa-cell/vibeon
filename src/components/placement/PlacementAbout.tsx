"use client";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { Icon } from "../Icon";
import type { IconName } from "../icon-paths";

const STEPS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1"];
// пример: разминка A1–A2 → поиск: B1 ✓ → B2 ✗ → проверка B1 по всем темам (простые задания — B1, сложные — B1+), в конце добор и перепроверка
const PATH = [0, 2, 2, 4, 4, 4, 6, 6, 6, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 4, 5, 4, 4];
const OK = [1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1];
const ZONES: [number, number, "warm" | "find" | "check"][] = [[0, 2, "warm"], [3, 8, "find"], [9, PATH.length - 1, "check"]];

/** «Как устроен тест» — коротко и тезисами: как ищет уровень, что внутри, как читать результат, почему ему можно доверять. */
export function PlacementAbout() {
  const { t } = useT();
  const W = 640, H = 230, x0 = 40, top = 34, dx = (W - x0 - 14) / (PATH.length - 1), y = (s: number) => H - 22 - s * ((H - 22 - top - 6) / 8);
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
          {ZONES.map(([a, b, k]) => (
            <g key={k}>
              <rect x={x0 + a * dx - dx / 2 + 1} y={top - 4} width={(b - a + 1) * dx - 2} height={H - 22 - top + 12} rx="8" className={`zone ${k}`} />
              <text x={x0 + ((a + b) / 2) * dx} y={top - 12} textAnchor="middle" className={`ztitle ${k}`}>{t(`pl.ab.z.${k}` as DictKey)}</text>
            </g>
          ))}
          <polyline points={PATH.map((s, i) => `${x0 + i * dx},${y(s)}`).join(" ")} className="path" />
          {PATH.map((s, i) => <circle key={i} cx={x0 + i * dx} cy={y(s)} r="5" className={OK[i] ? "ok" : "bad"} />)}
          <text x={x0 + ((9 + PATH.length - 1) / 2) * dx} y={y(6) + 4} textAnchor="middle" className="note b">{t("pl.ab.result")}</text>
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
      {list("pl.ab2.tips", ["pl.ab2.t1", "pl.ab2.t2", "pl.ab2.t3", "pl.ab2.t4", "pl.ab2.t5"])}
    </div>
  );
}
