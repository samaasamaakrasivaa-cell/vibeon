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
  // геометрия: слева подписи уровней, в середине три зоны с промежутками (у каждой свои линии), справа — карточка итога
  const W = 700, H = 250, top = 40, bot = H - 22, xL = 50, xR = 548, gap = 10, pad = 10;
  const counts = [WARM.length, FIND.length, CHECK.length], n = counts.reduce((a, b) => a + b, 0);
  const u = (xR - xL - 2 * gap - 3 * 2 * pad) / n;
  const zx: number[] = []; { let x = xL; for (const c of counts) { zx.push(x); x += c * u + 2 * pad + gap; } }
  const zw = (k: number) => counts[k] * u + 2 * pad;
  const y = (s: number) => bot - 10 - s * ((bot - 10 - top - 12) / 8);
  const px = (k: number, i: number) => zx[k] + pad + (i + 0.5) * u;
  const lane = (k: "e" | "h" | "r") => (k === "h" ? 5 : 4);
  const zones = ["warm", "find", "check"];
  const path: [number, number, number][] = [...WARM.map(([s2, ok], i) => [px(0, i), s2, ok] as [number, number, number]), ...FIND.map(([s2, ok], i) => [px(1, i), s2, ok] as [number, number, number])];
  const cardX = xR + 16, cardW = W - cardX - 4;
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
          {STEPS.map((s2, i) => <text key={s2} x={xL - 8} y={y(i) + 4} textAnchor="end" className="lab">{s2}</text>)}
          {zones.map((k, zi) => (
            <g key={k}>
              <rect x={zx[zi]} y={top} width={zw(zi)} height={bot - top} rx="10" className={`zone z-${k}`} />
              {STEPS.map((s2, i) => <line key={s2} x1={zx[zi] + 4} x2={zx[zi] + zw(zi) - 4} y1={y(i)} y2={y(i)} className="grid" />)}
              <text x={zx[zi] + zw(zi) / 2} y={top - 12} textAnchor="middle" className={`ztitle z-${k}`}>{t(`pl.ab.z.${k}` as DictKey)}</text>
            </g>
          ))}
          <polyline points={path.map(([x, s2]) => `${x},${y(s2)}`).join(" ")} className="path" />
          <line x1={path[path.length - 1][0]} y1={y(path[path.length - 1][1])} x2={px(2, 0)} y2={y(4)} className="path dash" />
          {path.map(([x, s2, ok], i) => <circle key={i} cx={x} cy={y(s2)} r="5" className={ok ? "ok" : "bad"} />)}
          {CHECK.map(([k, ok], i) => <circle key={i} cx={px(2, i)} cy={y(lane(k))} r={k === "r" ? 5.5 : 5} className={`${k === "r" ? "rep " : ""}${ok ? "ok" : "bad"}`} />)}
          <g>
            <rect x={cardX} y={y(6.6)} width={cardW} height={112} rx="12" className="rescard" />
            <text x={cardX + 14} y={y(6.6) + 22} className="restitle">{t("pl.ab3.resT")}</text>
            <text x={cardX + 14} y={y(6.6) + 50} className="resbig">B1+</text>
            <text x={cardX + 14} y={y(6.6) + 74} className="note">{t("pl.ab3.laneH")}</text>
            <text x={cardX + 14} y={y(6.6) + 94} className="note">{t("pl.ab3.laneE")}</text>
          </g>
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
