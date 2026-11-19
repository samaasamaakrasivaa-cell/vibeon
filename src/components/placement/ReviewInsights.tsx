"use client";
// Разбор placement test для учителя: таблица по навыкам и «Вывод системы» — по блокам (грамматика, лексика, чтение,
// аудирование, письмо, говорение). В каждом блоке: как тест шёл по уровням, статистика, что это значит, время,
// ошибки по темам и разбор ответов этого блока (раскрывается). Таблицу и списки ошибок можно скачать в PDF.
import { useRef } from "react";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { PL_LEVELS, STEPS, type Summary } from "@/lib/placement/engine";
import type { ReviewData } from "@/lib/placement/review";
import { Icon } from "../Icon";
import { fmtSec, PlacementAnswers } from "./PlacementAnswers";
import { assignExtraBlock } from "@/lib/placement/actions";
import { useRun } from "../courses/useRun";

type R = [number, number];
type Item = ReviewData["core"][number];
const pct = (r: R) => (r[1] ? Math.round((r[0] / r[1]) * 100) : 0);
const cnt = (xs: { ok: boolean }[]): R => [xs.filter((x) => x.ok).length, xs.length];
const cell = (r?: R) => (r && r[1] ? <><b>{pct(r)}%</b> <span className="muted">{r[0]}/{r[1]}</span></> : <span className="muted">—</span>);
const UP = new Set(["s", "x", "u", "b"]); // задания уровнем выше: срез, добор к нему, шаги вверх, пограничные по разделам
const lvIdx = (l: string) => PL_LEVELS.indexOf(l as never);

/** Скачать в PDF одну часть страницы: печать только этого блока (в окне печати — «Сохранить как PDF»). */
function printPart(el: HTMLElement | null) {
  if (!el) return;
  el.setAttribute("data-print-on", "");
  document.body.classList.add("print-one");
  const done = () => { el.removeAttribute("data-print-on"); document.body.classList.remove("print-one"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
  setTimeout(done, 1500);
}
function PdfBtn({ target }: { target: React.RefObject<HTMLElement | null> }) {
  const { t } = useT();
  return <button type="button" className="btn plain sm noprint" onClick={() => printPart(target.current)}><Icon name="dl" size="sm" />{t("pr.pdf")}</button>;
}

type Ans = { id: string; d: ReviewData; reveal: string[] };
/** Имя файла латиницей: браузеры не везде сохраняют файлы с кириллицей в названии, созданные на странице. */
const TR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const fileName = (s: string) => s.split("").map((c) => { const l = c.toLowerCase(), r = TR[l]; return r === undefined ? c : c === l ? r : r.charAt(0).toUpperCase() + r.slice(1); }).join("").replace(/[^A-Za-z0-9 _-]+/g, " ").trim().replace(/\s+/g, "_");

/** Разбор блока — в Word: тот же текст (задание, ответ ученика, правильный ответ, пояснение) в простом документе. */
function toWord(el: HTMLElement | null, name: string) {
  if (!el) return;
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll("button, audio, .noprint").forEach((x) => x.remove());
  c.querySelectorAll("details").forEach((x) => x.setAttribute("open", ""));
  const css = "body{font-family:Calibri,Arial,sans-serif;font-size:11pt} .plans{border-left:3px solid #ccc;padding:4px 8px;margin:6px 0} .plans.ok{border-color:#34C759} .plans.bad{border-color:#FF3B30} s{color:#C0392B} b{color:#111} .muted,.small{color:#666;font-size:9.5pt} .plab{font-weight:bold;margin-top:10px} .plnum{font-weight:bold;margin-right:6px}";
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${name}</title><style>${css}</style></head><body><h2>${name}</h2>${c.innerHTML}</body></html>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/msword" }));
  a.download = `${fileName(name)}.doc`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Блок раздела: закрыт по умолчанию; в шапке — раздел, уровень и время. */
export function Block({ title, step, time, idle, children, note, defaultOpen }: { title: string; step: string; time: string | null; idle: string | null; children: React.ReactNode; note?: string | null; defaultOpen?: boolean }) {
  const { t } = useT();
  return (
    <details className="prblock" open={defaultOpen}>
      <summary className="prblock-h">
        <b className="grow">{title}</b>
        {note && <span className="pill orange">{note}</span>}
        {time && <span className="small muted prtime"><Icon name="clock" size="sm" />{time}{idle ? ` · ${t("pr.idle", { s: idle })}` : ""}</span>}
        <span className="pill">{step}</span>
        <span className="prchev" aria-hidden="true"><Icon name="chevd" size="sm" /></span>
      </summary>
      <div className="prblock-b">{children}</div>
    </details>
  );
}

/** Разбор ответов блока: раскрывается; можно скачать PDF/Word — смотреть вместе с учеником. */
function AnswersBox({ ans, who, title, only }: { ans: Ans; who: string; title: string; only: "core" | "vocab" | "reading" | "listening" }) {
  const { t } = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const name = `Placement test · ${who} · ${title}`;
  return (
    <details className="prdet">
      <summary>{t("pr.answers")}</summary>
      <div className="prdl noprint"><span className="small muted">{t("pr.dlTitle")}:</span>
        <button type="button" className="btn plain sm" onClick={() => printPart(boxRef.current)}><Icon name="dl" size="sm" />{t("pr.dlPdf")}</button>
        <button type="button" className="btn plain sm" onClick={() => toWord(boxRef.current, name)}><Icon name="dl" size="sm" />{t("pr.dlWord")}</button>
      </div>
      <div className="mt-2" ref={boxRef}><div className="printonly"><b>{name}</b></div><PlacementAnswers id={ans.id} d={ans.d} teacher reveal={ans.reveal} only={only} /></div>
    </details>
  );
}

/** Подраздел блока: заголовок-строка и содержимое. */
const Sub = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="prsub"><h4 className="prh">{title}</h4>{children}</div>;
/** Строки-факты с маркером. */
const Facts = ({ list }: { list: (React.ReactNode | null | false | 0 | "")[] }) => { const xs = list.filter(Boolean); return xs.length ? <ul className="prfacts">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul> : null; };
/** Результат «4/6 · 67%» с полоской. */
const Res = ({ r }: { r: R }) => <span className="prres"><b>{r[0]}/{r[1]}</b><span className={`prbar ${pct(r) >= 75 ? "ok" : pct(r) >= 50 ? "mid" : "bad"}`}><i style={{ width: `${pct(r)}%` }} /></span><span className="muted">{pct(r)}%</span></span>;
/** Маленькая таблица: заголовки и строки. */
const Tbl = ({ head, rows }: { head?: string[]; rows: React.ReactNode[][] }) => rows.length ? (
  <div className="tblwrap"><table className="prtbl">{head && <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>}<tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table></div>
) : null;

/** Лесенка: как тест шёл по уровням — точка на каждую серию заданий одного уровня подряд, цвет — сколько верно. */
export function Ladder({ stops }: { stops: { level: string; r: R; tag?: string }[] }) {
  const { t } = useT();
  if (stops.length < 2) return null;
  const lv: readonly string[] = PL_LEVELS;
  const used = lv.filter((l) => stops.some((s) => s.level === l));
  const rows = lv.slice(lv.indexOf(used[0]), lv.indexOf(used[used.length - 1]) + 1);
  const W = 52, H = 34, padL = 34, padT = 22;
  const w = padL + stops.length * W, h = padT + rows.length * H + 4;
  const y = (l: string) => padT + (rows.length - 1 - rows.indexOf(l)) * H + H / 2;
  const x = (i: number) => padL + i * W + W / 2;
  const tone = (r: R) => (pct(r) >= 75 ? "ok" : pct(r) >= 50 ? "mid" : "bad");
  return (
    <figure className="prladder">
      <div className="prladder-scroll">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={stops.map((s) => `${s.level} ${s.r[0]}/${s.r[1]}`).join(", ")}>
          {rows.map((l) => <g key={l}><line x1={padL} x2={w} y1={y(l)} y2={y(l)} className="prl-grid" /><text x={4} y={y(l) + 4} className="prl-ax">{l}</text></g>)}
          <polyline points={stops.map((s, i) => `${x(i)},${y(s.level)}`).join(" ")} className="prl-line" />
          {stops.map((s, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(s.level)} r={7} className={`prl-dot ${tone(s.r)}`} />
              <text x={x(i)} y={y(s.level) - 12} textAnchor="middle" className="prl-v">{s.r[0]}/{s.r[1]}</text>
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="small muted">{t("pr.ladderHint")} <span className="prl-key ok" /> {t("pr.lgOk")} <span className="prl-key mid" /> {t("pr.lgMid")} <span className="prl-key bad" /> {t("pr.lgBad")}</figcaption>
    </figure>
  );
}
/** Серии подряд одного уровня → точки лесенки. */
const runs = (xs: { level: string; ok: boolean }[]) => {
  const out: { level: string; r: R }[] = [];
  for (const x of xs) { const l = out[out.length - 1]; if (l && l.level === x.level) { l.r = [l.r[0] + (x.ok ? 1 : 0), l.r[1] + 1]; } else out.push({ level: x.level, r: [x.ok ? 1 : 0, 1] }); }
  return out;
};

/** Задание другого уровня в блоке (уточнить уровень): ученику уходит короткий набор этого уровня,
 *  результат добавится в разбор; итог ученику — после того, как учитель сохранит его заново. */
function ExtraBlock({ id, kind, step, status, mode, xs }: { id: string; kind: "core" | "vocab" | "reading" | "listening"; step: number | null; status: string; mode: string; xs: { kind: string; level: string; at: number }[] }) {
  const { t } = useT();
  const { run, pending, error } = useRun();
  if (step === null || mode === "self") return null;
  const li = Math.floor(Math.max(0, Math.min(8, step)) / 2);
  const up = PL_LEVELS[li + 1], down = li > 0 ? PL_LEVELS[li - 1] : undefined, same = PL_LEVELS[li];
  const mine = xs.filter((x) => x.kind === kind);
  const waiting = status === "new" || status === "active";
  const give = (lv: string) => { if (confirm(t("pr.xConfirm", { b: t(`pl.part.${kind}` as DictKey).toLowerCase(), l: lv }))) run(() => assignExtraBlock(id, kind, lv)); };
  return (
    <div className="prextra noprint">
      {mine.length > 0 && <span className="small muted">{t("pr.xGiven", { list: mine.map((x) => x.level).join(", ") })}{waiting ? ` · ${t("pr.xWait")}` : ""}</span>}
      {!waiting && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="small muted">{t("pr.xGive")}:</span>
          {up && <button type="button" className="btn secondary sm" disabled={pending} onClick={() => give(up)}><Icon name="right" size="sm" />{t("pr.xUp", { l: up })}</button>}
          {down && <button type="button" className="btn secondary sm" disabled={pending} onClick={() => give(down)}><Icon name="chevl" size="sm" />{t("pr.xDown", { l: down })}</button>}
          <button type="button" className="btn plain sm" disabled={pending} onClick={() => give(same)}>{t("pr.xSame", { l: same })}</button>
        </div>
      )}
      {error && <span className="small text-bad">{error}</span>}
    </div>
  );
}

/** v6: лесенка сериями, итог по каждой теме найденного уровня, пробелы базы, уверенность. */
const VERD: Record<string, [string, string]> = { own: ["green", "pr.v.own"], part: ["orange", "pr.v.part"], gap: ["red", "pr.v.gap"] };
function V6Grammar({ v, G, answerRows, extra }: { v: NonNullable<Summary["v6"]>; G: Item[]; answerRows: React.ReactNode[][]; extra: React.ReactNode[][] }) {
  const { t } = useT();
  const topicRow = (x: NonNullable<Summary["v6"]>["topics"][number]) => [
    <span key="n">{x.name}{x.roots.length > 0 && <span className="small muted block">{t("pr.root", { list: x.roots.join(", ") })}</span>}</span>,
    <Res key="r" r={[x.c, x.n]} />,
    x.verdict ? <span key="v" className={`pill ${VERD[x.verdict][0]}`}>{t(VERD[x.verdict][1] as DictKey)}</span> : "—",
    <span key="f" className="prflags">
      {x.sureWrong && x.verdict !== "own" && <span className="pill red">{t("pr.f.sureWrong")}</span>}
      {x.fix === true && x.verdict !== "own" && <span className="pill grey">{t("pr.f.fixOk")}</span>}
      {x.fix === false && x.verdict !== "gap" && <span className="pill grey">{t("pr.f.fixNo")}</span>}
      {x.slow && x.verdict === "own" && <span className="pill grey">{t("pr.f.slow")}</span>}
    </span>,
  ];
  const byGroup = [...new Set(v.topics.map((x) => x.groupName))];
  const cnt = (k: string) => v.topics.filter((x) => x.verdict === k).length;
  const gaps = v.topics.filter((x) => x.verdict === "gap").map((x) => x.name);
  const conf = v.conf;
  return (
    <>
      <Sub title={t("pr.path")}>
        <Ladder stops={runs(G.filter((x) => x.ph === "q"))} />
        <ul className="prfacts">
          {v.ladder.map((l, i) => (
            <li key={i} className={l.verdict === "down" ? "bad" : l.verdict === "up" ? "" : "mid"}>
              <b>{l.level}</b> [{l.series.map((s2) => `${s2.c}/${s2.n}`).join(" ")}] — {Math.round(l.p * 100)}%
              {" "}{l.verdict === "up" ? t("pr.l.up") : l.verdict === "down" ? t("pr.l.down") : t("pr.l.open")}
            </li>
          ))}
        </ul>
        {v.found && <p className="m-0"><b>{t("pr.l.found", { l: v.found })}</b></p>}
      </Sub>
      {extra.length > 0 && <Sub title={t("pr.sec.detail")}><Tbl head={[t("pr.col.level"), t("pr.col.easy"), t("pr.col.hard"), t("pr.col.all")]} rows={extra} /></Sub>}
      {v.topics.length > 0 && (
        <Sub title={t("pr.topicsT", { l: v.found ?? "" })}>
          <p className="small muted m-0">{t("pr.topicsHint")}</p>
          {byGroup.map((g) => (
            <div key={g} className="prgrp">
              <div className="small font-semibold">{g}</div>
              <Tbl rows={v.topics.filter((x) => x.groupName === g).map(topicRow)} />
            </div>
          ))}
        </Sub>
      )}
      {v.base.length > 0 && (
        <Sub title={t("pr.baseT")}>
          <p className="small muted m-0">{t("pr.baseHint")}</p>
          <Tbl rows={v.base.map((x) => [<span key="n">{x.name} <span className="pill grey">{x.level}</span></span>, ...topicRow(x).slice(1)])} />
        </Sub>
      )}
      <Sub title={t("pr.analysis")}>
        <Tbl rows={[...answerRows,
          ...(conf.unsureRight ? [[t("pr.c.unsureRight"), String(conf.unsureRight)]] : []),
          ...(conf.sureWrong ? [[t("pr.c.sureWrong"), String(conf.sureWrong)]] : []),
        ]} />
      </Sub>
      <Mean text={[t("pr.v6Out", { own: cnt("own"), part: cnt("part"), gap: cnt("gap") }), gaps.length ? t("pr.v6Gaps", { list: gaps.slice(0, 4).join(", ") }) : ""].filter(Boolean).join(" ")} />
    </>
  );
}

/** Вывод по блоку — отдельной плашкой внизу. */
function Mean({ text }: { text: string | null }) { const { t } = useT(); return text ? <p className="prmean"><Icon name="spark" size="sm" /> <span><b>{t("pr.outLabel")}: </b>{text}</span></p> : null; }

export type InsightsProps = {
  id: string; who: string; sm: Summary; d: ReviewData; reveal: string[];
  has: (k: string) => boolean; steps: Record<string, number | null>; hint: number | null;
  tm: Record<string, number>; idle: Record<string, number>; dates?: Record<string, string>;
  base?: { sub: string; from: "test" | "teacher" } | null; wsWaiting: { writing: boolean; speaking: boolean };
  wsRows: Record<"writing" | "speaking", Record<string, [number, number]>>; // баллы учителя за письмо и говорение по уровням заданий
  status: string; mode: string; children?: React.ReactNode;
};

export function ReviewInsights(p: InsightsProps) {
  const { t } = useT();
  const { sm, d } = p;
  const tableRef = useRef<HTMLElement>(null), topicsRef = useRef<HTMLDivElement>(null), vErrRef = useRef<HTMLDivElement>(null);
  const L = PL_LEVELS.filter((l) => sm.core[l] || sm.reading[l] || sm.listening[l] || p.wsRows.writing[l] || p.wsRows.speaking[l]);
  const G = d.core.filter((x) => !x.vocab), V = d.core.filter((x) => x.vocab);
  const lvName = (s: number | null) => (s === null ? "—" : STEPS[s]);
  const time = (k: string) => (p.tm[k] ? fmtSec(p.tm[k]) : null);

  // ── грамматика: путь по уровням
  const warm = G.filter((x) => x.ph === "w");
  // уровни подробной проверки — в том порядке, как тест их проверял
  const dLevels = [...new Set(G.filter((x) => x.ph === "d").map((x) => x.level))];
  // узнаёт или употребляет: выбор из вариантов и «вписать самому»
  const fc = sm.forms.choice, ft = sm.forms.typed;
  const formsMean = ft[1] >= 3 && fc[1] >= 3 ? t(pct(ft) >= 80 && pct(fc) >= 80 ? "pr.formsActive" : pct(fc) - pct(ft) >= 20 ? "pr.formsPassive" : pct(ft) >= pct(fc) ? "pr.formsEven" : "pr.formsSlight") : null;
  const errGroups = sm.groups.filter((g) => g.c < g.n).sort((a, b) => (b.n - b.c) - (a.n - a.c) || lvIdx(a.level) - lvIdx(b.level));
  const repYes = sm.repeats.filter((x) => !x.again), repNo = sm.repeats.filter((x) => x.again);
  const gDk = G.filter((x) => x.dk);
  const slow = (xs: Item[]) => [...xs].filter((x) => x.ms !== null).sort((a, b) => b.ms! - a.ms!).slice(0, 3).filter((x) => x.ms! > 20000);
  const fast = (xs: Item[]) => xs.filter((x) => x.ms !== null && x.ms < 3000).length;
  const avg = (xs: Item[]) => { const m = xs.map((x) => x.ms).filter((x): x is number => x !== null); return m.length ? fmtSec(m.reduce((a, b) => a + b, 0) / m.length) : null; };

  // ── лексика
  const vLv = (sm.vlevels ?? []).map((x) => { const items = V.filter((y) => y.level === x.level); return { ...x, r: cnt(items) }; }).filter((x) => x.r[1]);
  const vChoice = cnt(V.filter((x) => x.type === "mcq")), vTyped = cnt(V.filter((x) => x.type !== "mcq"));
  const vErr = V.filter((x) => !x.ok);
  const vWeakKinds = (sm.vlevels ?? []).flatMap((x) => x.kinds.filter((k) => k.c < k.n).map((k) => ({ ...k, level: x.level })));

  // ── чтение и аудирование
  const texts = (list: ReviewData["reading"]) => list.map((x) => ({ title: x.title, level: x.level, r: cnt(x.questions), dk: x.questions.filter((q) => q.dk).length, plays: x.plays }));
  const meanOf = (r: R) => t(pct(r) >= 85 ? "pr.textOk" : pct(r) >= 60 ? "pr.textMid" : "pr.textBad");

  // время блока — таблицей: активное, перерывы, в среднем, дольше всего, слишком быстро, «Не знаю»
  const timeBox = (k: string, xs: Item[] | null, dk: number) => {
    const rows: React.ReactNode[][] = [];
    if (p.tm[k]) rows.push([t("pr.t.active"), fmtSec(p.tm[k])]);
    if (p.idle[k]) rows.push([t("pr.t.idle"), fmtSec(p.idle[k])]);
    if (xs) {
      const a = avg(xs), sl = slow(xs), f = fast(xs);
      if (a) rows.push([t("pr.t.avg"), a]);
      if (sl.length) rows.push([t("pr.slowest"), <ul key="s" className="prfacts m-0">{sl.map((x) => <li key={x.id}>«{x.q.slice(0, 60)}{x.q.length > 60 ? "…" : ""}» — {fmtSec(x.ms!)}</li>)}</ul>]);
      if (f) rows.push([t("pr.t.fast"), <span key="f" className="text-bad">{t("pr.t.fastN", { n: f })}</span>]);
      if (dk) rows.push([t("pr.row.dk"), xs.filter((x) => x.dk).map((x) => x.topic).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 6).join(", ")]);
    }
    return rows.length ? <details className="prdet"><summary>{t("pr.sec.time")}</summary><div className="mt-2"><Tbl rows={rows} /></div></details> : null;
  };

  const read = texts(d.reading), listen = texts(d.listening);
  const ans: Ans = { id: p.id, d, reveal: p.reveal };
  const total = Object.values(p.tm).reduce((a, b) => a + b, 0);
  const warmLine = warm.length ? ((r) => <>{t("pr.warmT")}: <b>{r[0]}/{r[1]}</b> — {t(r[0] === r[1] ? "pr.warmM.ok" : pct(r) >= 60 ? "pr.warmM.mid" : "pr.warmM.bad")}</>)(cnt(warm)) : null;
  const sureG = sm.anchors.filter((a) => a.pass && a.c === a.n).map((a) => a.level);
  // подробная проверка: по уровням — простые, сложные, всего
  const detailRows: React.ReactNode[][] = dLevels.map((lv) => {
    const at = G.filter((x) => x.level === lv && !UP.has(x.ph ?? "") && x.ph !== "w" && x.ph !== "l");
    const easy = at.filter((x) => x.step % 2 === 0 || lv === "C1"), hard = at.filter((x) => x.step % 2 === 1 && lv !== "C1");
    return [lv, easy.length ? <Res r={cnt(easy)} /> : "—", hard.length ? <Res r={cnt(hard)} /> : "—", <Res r={cnt(at)} />];
  });
  for (const lv of PL_LEVELS) { const ups = G.filter((x) => x.level === lv && UP.has(x.ph ?? "")); if (ups.length) detailRows.push([<>{lv} <span className="small muted">{t("pr.row.up")}</span></>, "—", "—", <Res r={cnt(ups)} />]); }
  const extraRows: React.ReactNode[][] = [];
  for (const lv of PL_LEVELS) { const xz = G.filter((x) => x.ph === "z" && x.level === lv); if (xz.length) extraRows.push([<>{lv} <span className="small muted">{t("pr.row.extra")}</span></>, "—", "—", <Res r={cnt(xz)} />]); }
  detailRows.push(...extraRows);
  const climbs = dLevels.slice(1).map((lv, i) => t("pr.climbShort", { from: dLevels[i], to: lv }));
  const answerRows = (xs: Item[]): React.ReactNode[][] => {
    const ch = cnt(xs.filter((x) => x.type === "mcq")), ty = cnt(xs.filter((x) => x.type !== "mcq")), dk = xs.filter((x) => x.dk).length, hi = xs.filter((x) => x.hinted).length;
    return [
      ...(ch[1] ? [[t("pr.row.choice"), <Res r={ch} />]] : []),
      ...(ty[1] ? [[t("pr.row.typed"), <Res r={ty} />]] : []),
      ...(dk ? [[t("pr.row.dk"), t("pr.row.dkv", { n: dk, w: xs.filter((x) => !x.ok).length })]] : []),
      ...(hi ? [[t("pr.row.hint"), String(hi)]] : []),
    ];
  };
  const gOut = G.length ? [t("pr.gOut", { l: lvName(p.has("core") ? p.steps.core ?? null : null) }), errGroups.length ? t("pr.outTopics", { n: errGroups.length }) : t("pr.outClean"), formsMean].filter(Boolean).join(" ") : null;
  const vOut = V.length ? [t("pr.vOut", { l: lvName(p.steps.vocab ?? null) }), vErr.length ? t("pr.vOutErr", { n: vErr.length }) : t("pr.outClean"), vTyped[1] >= 3 && vChoice[1] >= 3 ? t(pct(vTyped) >= 80 && pct(vChoice) >= 80 ? "pr.vActive" : pct(vChoice) - pct(vTyped) >= 20 ? "pr.vPassive" : "pr.vEven") : null].filter(Boolean).join(" ") : null;
  return (
    <>
      <section className="card flex flex-col gap-3" ref={tableRef}>
        <div className="printonly"><b>Placement test · {p.who}</b></div>
        <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 grow">{t("pl.table")}</h3><PdfBtn target={tableRef} /></div>
        <div className="tblwrap">
          <table className="pltable">
            <thead><tr><th />{L.map((l) => <th key={l}>{l}</th>)}</tr></thead>
            <tbody>
              <tr><th>{t("pl.grammar")}</th>{L.map((l) => <td key={l}>{cell(sm.core[l]?.grammar)}</td>)}</tr>
              <tr><th>{t("pl.vocab")}</th>{L.map((l) => <td key={l}>{cell(sm.core[l]?.vocabulary)}</td>)}</tr>
              <tr><th>{t("pl.part.reading")}</th>{L.map((l) => <td key={l}>{cell(sm.reading[l])}</td>)}</tr>
              <tr><th>{t("pl.part.listening")}</th>{L.map((l) => <td key={l}>{cell(sm.listening[l])}</td>)}</tr>
              {(["writing", "speaking"] as const).filter((k) => d[k] || Object.keys(p.wsRows[k]).length).map((k) => (
                <tr key={k}><th>{t(`pl.part.${k}`)}<div className="small muted">{t("pr.wsScore")}</div></th>{L.map((l) => <td key={l}>{p.wsRows[k][l] ? <><b>{pct(p.wsRows[k][l])}%</b> <span className="muted">{p.wsRows[k][l][0]}/{p.wsRows[k][l][1]}</span></> : l === d[k]?.level ? <span className="small muted">{t("pr.wsNotYet")}</span> : <span className="muted">—</span>}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="plsteps">
          {(["core", "vocab", "reading", "listening", "writing", "speaking"] as const).map((k) => (
            <div key={k} className={p.has(k) ? undefined : "plsteps-off"}>
              <span>{t(`pl.part.${k}` as DictKey)}</span>
              <b>{!p.has(k) ? t("pl.notInTest") : lvName(p.steps[k] ?? null)}</b>
              {p.dates?.[k] && <small className="muted">{p.dates[k]}</small>}
            </div>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 grow prtitle"><Icon name="spark" size="sm" />{t("pl.exTitle")}</h3>
          {total > 0 && <span className="small muted">{t("pr.totalTime", { s: fmtSec(total) })}</span>}
        </div>
        <p className="small muted m-0">{t("pr.blocksHint")}</p>

        {(G.length > 0 || p.base) && (
          <Block time={time("core")} idle={p.idle.core ? fmtSec(p.idle.core) : null} title={t("pl.part.core")} step={lvName(p.has("core") ? p.steps.core ?? null : null)}>
            {sm.v6 ? <V6Grammar v={sm.v6} G={G} answerRows={answerRows(G)} extra={extraRows} /> : (<>
            <Sub title={t("pr.path")}>
              <Facts list={[warmLine, sm.anchors.length > 0 && t("pr.searchT"), sm.fb && sm.diag && t("pr.fallback", { l: PL_LEVELS[lvIdx(sm.diag) + 1] ?? "", d: sm.diag }), !p.has("core") && p.base && t(p.base.from === "test" ? "pl.exBaseTest" : "pl.exBaseTeacher", { l: p.base.sub })]} />
              <Ladder stops={runs(G.filter((x) => x.ph !== "w"))} />
              <Facts list={[sureG.length > 0 && <>{t("pr.sureT")}: <b>{sureG[sureG.length - 1]}</b></>, ...climbs]} />
            </Sub>
            {detailRows.length > 0 && <Sub title={t("pr.sec.detail")}><Tbl head={[t("pr.col.level"), t("pr.col.easy"), t("pr.col.hard"), t("pr.col.all")]} rows={detailRows} /></Sub>}
            {(answerRows(G).length > 0 || sm.repeats.length > 0) && (
              <Sub title={t("pr.analysis")}>
                <Tbl rows={answerRows(G)} />
                {sm.repeats.length > 0 && <>
                  <p className="small font-semibold m-0 mt-2">{t("pr.rep.title")}</p>
                  <ul className="prfacts">{[...repYes.map((x) => ({ x, yes: true })), ...repNo.map((x) => ({ x, yes: false }))].map(({ x, yes }) => <li key={x.topic} className={yes ? "bad" : "mid"}><b>{x.topic}</b> — {t(yes ? "pr.rep.yes" : "pr.rep.no")}</li>)}</ul>
                </>}
              </Sub>
            )}
            <Mean text={gOut} />
            </>)}
            <div className="prmore">
              {G.length > 0 && <AnswersBox ans={ans} who={p.who} title={t("pl.part.core")} only="core" />}
              {sm.families.length > 0 && (
                <details className="prdet">
                  <summary>{t("pl.famTitle")}</summary>
                  <div className="tblwrap mt-2">
                    <table className="pltable plfam">
                      <thead><tr><th>{t("pl.famCol")}</th>{PL_LEVELS.filter((l) => sm.families.some((f) => f.by?.[l]?.[1])).map((l) => <th key={l}>{l}</th>)}<th>{t("pl.famAll")}</th></tr></thead>
                      <tbody>
                        {sm.families.map((f) => (
                          <tr key={f.id}><th><b>{f.name}</b></th>{PL_LEVELS.filter((l) => sm.families.some((x) => x.by?.[l]?.[1])).map((l) => <td key={l}>{f.by?.[l]?.[1] ? <b>{f.by[l][0]}/{f.by[l][1]}</b> : <span className="muted">—</span>}</td>)}<td><b>{f.all[0]}/{f.all[1]}</b> <span className="muted">{pct(f.all)}%</span></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              {errGroups.length > 0 ? (
                <details className="prdet">
                  <summary>{t("pr.topicsErr")} · {errGroups.length}</summary>
                  <div ref={topicsRef} className="prerr mt-2">
                    <div className="printonly"><b>Placement test · {p.who} · {t("pr.topicsErr")}</b></div>
                    <div className="flex justify-end"><PdfBtn target={topicsRef} /></div>
                    <div className="plgroups">
                      {errGroups.map((g) => (
                        <div key={g.id} className={`plgrow ${g.c / g.n >= 0.6 ? "mid" : "bad"}`}>
                          <span className="plgico">{g.c / g.n >= 0.6 ? "≈" : "✗"}</span>
                          <div className="grow min-w-0"><b>{g.name}</b> <span className="pill grey">{g.level}</span>{g.what && <div className="small muted">{g.what}</div>}</div>
                          <span className="plgres">{g.c}/{g.n}{g.dk > 0 && <small className="muted"> · {t("pl.dkShort", { n: g.dk })}</small>}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              ) : G.length > 0 && <p className="prmean ok m-0">✓ {t("pr.noTopicErr")}</p>}
              {timeBox("core", G, gDk.length)}
            </div>
            <ExtraBlock id={p.id} kind="core" step={p.has("core") ? p.steps.core ?? null : null} status={p.status} mode={p.mode} xs={d.xs ?? []} />
          </Block>
        )}

        {V.length > 0 && (
          <Block time={time("vocab")} idle={p.idle.vocab ? fmtSec(p.idle.vocab) : null} title={t("pl.part.vocab")} step={lvName(p.steps.vocab ?? null)}>
            <Sub title={t("pr.path")}>
              <Ladder stops={runs(V)} />
              <Tbl head={[t("pr.col.level"), t("pr.col.result"), t("pr.col.role")]} rows={[
                ...vLv.map((x) => [x.level, <Res r={x.r} />, t(x.warm ? "pr.vWarm" : x.level === sm.vlevel ? "pr.vMain" : lvIdx(x.level) > lvIdx(sm.vlevel ?? "A1") ? "pr.vUp" : "pr.vDown")]),
                ...PL_LEVELS.flatMap((lv) => { const xz = V.filter((x) => x.ph === "vz" && x.level === lv); return xz.length ? [[lv, <Res r={cnt(xz)} />, t("pr.row.extra")]] : []; }),
              ]} />
            </Sub>
            {answerRows(V).length > 0 && <Sub title={t("pr.analysis")}><Tbl rows={answerRows(V)} /></Sub>}
            <Mean text={vOut} />
            <div className="prmore">
              <AnswersBox ans={ans} who={p.who} title={t("pl.part.vocab")} only="vocab" />
              {vErr.length > 0 ? (
                <details className="prdet">
                  <summary>{t("pr.vErr")} · {vErr.length}</summary>
                  <div ref={vErrRef} className="prerr mt-2">
                    <div className="printonly"><b>Placement test · {p.who} · {t("pr.vErr")}</b></div>
                    <div className="flex justify-end"><PdfBtn target={vErrRef} /></div>
                    {vWeakKinds.length > 0 && <p className="small m-0">{t("pr.vKinds")}: {vWeakKinds.map((k) => `${k.name} (${k.level}, ${k.c}/${k.n})`).join("; ")}</p>}
                    <div className="tblwrap">
                      <table className="pltable prerrtbl">
                        <thead><tr><th>{t("pr.colLevel")}</th><th>{t("pr.colTask")}</th><th>{t("pr.colGiven")}</th><th>{t("pr.colRight")}</th></tr></thead>
                        <tbody>{vErr.map((x) => <tr key={x.id}><td>{x.level}</td><td>{x.base ? <b>{x.base} · </b> : null}{x.q}<div className="small muted">{x.topic}</div></td><td>{x.dk ? <span className="pill grey">{t("pl.dontKnow")}</span> : <s>{x.given || "—"}</s>}</td><td><b>{x.right}</b></td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                </details>
              ) : <p className="prmean ok m-0">✓ {t("pr.vNoErr")}</p>}
              {timeBox("vocab", V, V.filter((x) => x.dk).length)}
            </div>
            <ExtraBlock id={p.id} kind="vocab" step={p.steps.vocab ?? null} status={p.status} mode={p.mode} xs={d.xs ?? []} />
          </Block>
        )}

        {([["reading", read, p.steps.reading], ["listening", listen, p.steps.listening]] as const).map(([k, list, step]) => list.length > 0 && (
          <Block key={k} time={time(k)} idle={p.idle[k] ? fmtSec(p.idle[k]) : null} title={t(`pl.part.${k}`)} step={lvName(step)}>
            <Sub title={t("pr.path")}>
              <Ladder stops={list.map((x) => ({ level: x.level, r: x.r }))} />
              <Tbl head={[t("pr.col.text"), t("pr.col.level"), t("pr.col.result"), ...(k === "listening" ? [t("pr.col.plays")] : [])]} rows={list.map((x) => [x.title, x.level, <Res r={x.r} />, ...(k === "listening" ? [String(x.plays ?? 0)] : [])])} />
              <Facts list={[list.some((x) => x.dk) && t("pr.dkText", { n: list.reduce((a, x) => a + x.dk, 0) })]} />
            </Sub>
            <Mean text={(() => { const top = [...list].sort((a, b) => lvIdx(b.level) - lvIdx(a.level))[0]; return top ? `${top.level} — ${meanOf(top.r)}` : null; })()} />
            <div className="prmore">
              <AnswersBox ans={ans} who={p.who} title={t(`pl.part.${k}`)} only={k} />
              {timeBox(k, null, 0)}
            </div>
            <ExtraBlock id={p.id} kind={k} step={step ?? null} status={p.status} mode={p.mode} xs={d.xs ?? []} />
          </Block>
        ))}

        {/* письмо и говорение — задание, критерии и оценка учителя (передаются со страницы разбора) */}
        {p.children}
      </section>
    </>
  );
}
