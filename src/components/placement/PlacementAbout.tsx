"use client";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { Icon } from "../Icon";
import type { IconName } from "../icon-paths";

const STEPS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1"];
// пример: разминка A1, A2, A2 → лесенка: B1 (2 из 3 ✓) → B2 (1 из 3 ✗) → проверка B1 по всем темам
const WARM: [number, number][] = [[0, 1], [2, 1], [2, 1]];
const FIND: [number, number][] = [[4, 1], [4, 1], [4, 0], [6, 0], [6, 1], [6, 0]];
// проверка: e — простое задание (B1), h — сложное (B1+), r — перепроверка темы после ошибки
const CHECK: ["e" | "h" | "r", number][] = [["e", 1], ["e", 1], ["e", 0], ["e", 1], ["e", 1], ["h", 1], ["h", 0], ["h", 1], ["h", 1], ["h", 1], ["r", 1], ["h", 1], ["h", 1], ["r", 1]];

/** «Как устроен тест» — по этапам, коротко и без повторов. */
export function PlacementAbout() {
  const { t } = useT();
  const n = WARM.length + FIND.length + CHECK.length;
  const W = 660, H = 236, x0 = 64, top = 34, dx = (W - x0 - 120) / (n - 1), y = (s: number) => H - 24 - s * ((H - 24 - top - 6) / 8);
  const xi = (i: number) => x0 + i * dx;
  const lane = (k: "e" | "h" | "r") => (k === "h" ? 5 : 4);
  const zones: [number, number, string][] = [[0, WARM.length - 1, "warm"], [WARM.length, WARM.length + FIND.length - 1, "find"], [WARM.length + FIND.length, n - 1, "check"]];
  const path = [...WARM, ...FIND];
  const stage = (ic: IconName, title: DictKey, items: DictKey[], key: string) => (
    <li key={key}>
      <span className="pltl-ico"><Icon name={ic} size="sm" /></span>
      <div><b>{t(title)}</b><ul className="plabul">{items.map((k) => <li key={k}>{t(k)}</li>)}</ul></div>
    </li>
  );
  const list = (title: DictKey, keys: DictKey[]) => (
    <div className="plabtips"><b>{t(title)}</b>{keys.map((k) => <div key={k} className="plpoint"><span className="pldotc" />{t(k)}</div>)}</div>
  );
  return (
    <div className="plabout">
      <div className="plabsec">
        <div className="plabgroup">{t("pl.ab3.grammar")}</div>
        <ol className="pltimeline">
          {stage("spark", "pl.ab3.s1", ["pl.ab3.s1a", "pl.ab3.s1b"], "s1")}
          {stage("route", "pl.ab3.s2", ["pl.ab3.s2a", "pl.ab3.s2b", "pl.ab3.s2c", "pl.ab3.s2d"], "s2")}
          {stage("target", "pl.ab3.s3", ["pl.ab3.s3a", "pl.ab3.s3b", "pl.ab3.s3c", "pl.ab3.s3d", "pl.ab3.s3e", "pl.ab3.s3f"], "s3")}
        </ol>
      </div>
      <div className="plladder">
        <div className="small font-semibold mb-1">{t("pl.ab.ladder")}</div>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("pl.ab.ladder")}>
          {STEPS.map((s, i) => <g key={s}><line x1={x0 - dx / 2} x2={W - 6} y1={y(i)} y2={y(i)} className="grid" /><text x={x0 - dx / 2 - 8} y={y(i) + 4} textAnchor="end" className="lab">{s}</text></g>)}
          {zones.map(([a, b, k]) => (
            <g key={k}>
              <rect x={xi(a) - dx / 2 + 1} y={top - 4} width={(b - a + 1) * dx - 2} height={H - 24 - top + 12} rx="8" className={`zone z-${k}`} />
              <text x={xi((a + b) / 2)} y={top - 12} textAnchor="middle" className={`ztitle z-${k}`}>{t(`pl.ab.z.${k}` as DictKey)}</text>
            </g>
          ))}
          <polyline points={path.map(([s], i) => `${xi(i)},${y(s)}`).join(" ")} className="path" />
          <line x1={xi(path.length - 1)} y1={y(path[path.length - 1][0])} x2={xi(path.length)} y2={y(4)} className="path dash" />
          {path.map(([s, ok], i) => <circle key={i} cx={xi(i)} cy={y(s)} r="5" className={ok ? "ok" : "bad"} />)}
          {CHECK.map(([k, ok], j) => {
            const i = path.length + j;
            return k === "r" ? <circle key={i} cx={xi(i)} cy={y(lane(k))} r="5.5" className={`rep ${ok ? "ok" : "bad"}`} /> : <circle key={i} cx={xi(i)} cy={y(lane(k))} r="5" className={ok ? "ok" : "bad"} />;
          })}
          <text x={xi(n - 1) + 12} y={y(4) + 4} className="note">{t("pl.ab3.laneE")}</text>
          <text x={xi(n - 1) + 12} y={y(5) + 4} className="note">{t("pl.ab3.laneH")}</text>
          <text x={xi(n - 1) + 12} y={y(6.4)} className="note b">{t("pl.ab3.result")}</text>
        </svg>
        <div className="pllegend small muted">
          <span><i className="ok" />{t("pl.ab.right")}</span><span><i className="bad" />{t("pl.ab.wrong")}</span><span><i className="rep" />{t("pl.ab3.rep")}</span>
        </div>
        <p className="small muted m-0 mt-1">{t("pl.ab3.chart")}</p>
      </div>
      <div className="plabsec">
        <ol className="pltimeline" start={4}>
          {stage("cards", "pl.ab3.s4", ["pl.ab3.s4a", "pl.ab3.s4b", "pl.ab3.s4c", "pl.ab3.s4d"], "s4")}
          {stage("note", "pl.ab3.s5", ["pl.ab3.s5a", "pl.ab3.s5b", "pl.ab3.s5c"], "s5")}
          {stage("pencil", "pl.ab3.s6", ["pl.ab3.s6a", "pl.ab3.s6b", "pl.ab3.s6c", "pl.ab3.s6d"], "s6")}
        </ol>
      </div>
      {list("pl.ab2.read", ["pl.ab2.r1", "pl.ab2.r2", "pl.ab2.r3", "pl.ab2.r4"])}
      {list("pl.ab2.why", ["pl.ab3.w1", "pl.ab3.w2", "pl.ab2.w4"])}
      {list("pl.ab2.tips", ["pl.ab2.t1", "pl.ab2.t2", "pl.ab2.t3", "pl.ab2.t4", "pl.ab2.t5"])}
    </div>
  );
}
