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
function Block({ title, step, time, idle, children, answers, ans }: { title: string; step: string; time: string | null; idle: string | null; children: React.ReactNode; answers?: "core" | "vocab" | "reading" | "listening"; ans: Ans }) {
  const { t } = useT();
  return (
    <div className="prblock">
      <div className="prblock-h">
        <b className="grow">{title}</b>
        {time && <span className="small muted prtime"><Icon name="clock" size="sm" />{time}{idle ? ` · ${t("pr.idle", { s: idle })}` : ""}</span>}
        <span className="pill">{step}</span>
      </div>
      {children}
      {answers && (
        <details className="prdet noprint">
          <summary>{t("pr.answers")}</summary>
          <div className="mt-2"><PlacementAnswers id={ans.id} d={ans.d} teacher reveal={ans.reveal} only={answers} /></div>
        </details>
      )}
    </div>
  );
}
const Lines = ({ list }: { list: (string | null | false | 0)[] }) => <ul className="prlist">{list.filter(Boolean).map((x, i) => <li key={i}>{x}</li>)}</ul>;
const Mean = ({ text }: { text: string | null }) => (text ? <p className="prmean"><Icon name="spark" size="sm" /> {text}</p> : null);

export type InsightsProps = {
  id: string; who: string; sm: Summary; d: ReviewData; reveal: string[];
  has: (k: string) => boolean; steps: Record<string, number | null>; hint: number | null;
  tm: Record<string, number>; idle: Record<string, number>; dates?: Record<string, string>;
  base?: { sub: string; from: "test" | "teacher" } | null; wsWaiting: { writing: boolean; speaking: boolean };
};

export function ReviewInsights(p: InsightsProps) {
  const { t } = useT();
  const { sm, d } = p;
  const tableRef = useRef<HTMLElement>(null), topicsRef = useRef<HTMLDivElement>(null), vErrRef = useRef<HTMLDivElement>(null);
  const L = PL_LEVELS.filter((l) => sm.core[l] || sm.reading[l] || sm.listening[l]);
  const G = d.core.filter((x) => !x.vocab), V = d.core.filter((x) => x.vocab);
  const lvName = (s: number | null) => (s === null ? "—" : STEPS[s]);
  const time = (k: string) => (p.tm[k] ? fmtSec(p.tm[k]) : null);

  // ── грамматика: путь по уровням
  const gram: string[] = [];
  const warm = G.filter((x) => x.ph === "w");
  if (warm.length) { const r = cnt(warm); gram.push(t(r[0] === r[1] ? "pr.warmOk" : pct(r) >= 60 ? "pr.warmMid" : "pr.warmBad", { r: `${r[0]}/${r[1]}` })); }
  if (sm.anchors.length) {
    const sure = sm.anchors.filter((a) => a.pass && a.c === a.n).map((a) => a.level);
    gram.push(t("pr.ladder", { list: sm.anchors.map((a) => `${a.level} ${a.c}/${a.n}${a.pass ? " ✓" : a.pass === false ? " ✗" : ""}`).join(", ") }) + (sure.length ? ` ${t("pr.ladderSure", { l: sure[sure.length - 1] })}` : ""));
  }
  // уровни подробной проверки — в том порядке, как тест их проверял
  const dLevels = [...new Set(G.filter((x) => x.ph === "d").map((x) => x.level))];
  dLevels.forEach((lv, i) => {
    const at = G.filter((x) => x.level === lv && !UP.has(x.ph ?? "") && x.ph !== "w" && x.ph !== "l");
    const easy = at.filter((x) => x.step % 2 === 0 || lv === "C1"), hard = at.filter((x) => x.step % 2 === 1 && lv !== "C1");
    const all = cnt(at), e = cnt(easy), h = cnt(hard);
    const prev = dLevels[i - 1];
    if (prev) gram.push(t("pr.climb", { from: prev, to: lv }));
    gram.push(hard.length ? t("pr.detail", { l: lv, e: `${e[0]}/${e[1]}`, ep: pct(e), h: `${h[0]}/${h[1]}`, hp: pct(h), a: `${all[0]}/${all[1]}`, ap: pct(all) }) : t("pr.detailAll", { l: lv, a: `${all[0]}/${all[1]}`, ap: pct(all) }));
  });
  // задания уровнем выше на уровнях, которые подробно не проверялись (или проверялись — тогда это до подъёма)
  for (const lv of PL_LEVELS) {
    const ups = G.filter((x) => x.level === lv && UP.has(x.ph ?? ""));
    if (!ups.length) continue;
    const r = cnt(ups);
    gram.push(t(dLevels.includes(lv) ? "pr.upThenDetail" : "pr.upOnly", { l: lv, r: `${r[0]}/${r[1]}`, p: pct(r) }));
  }
  if (sm.fb && sm.diag) gram.push(t("pr.fallback", { l: PL_LEVELS[lvIdx(sm.diag) + 1] ?? "", d: sm.diag }));
  if (!p.has("core") && p.base) gram.push(t(p.base.from === "test" ? "pl.exBaseTest" : "pl.exBaseTeacher", { l: p.base.sub }));
  // узнаёт или употребляет: выбор из вариантов и «вписать самому»
  const fc = sm.forms.choice, ft = sm.forms.typed;
  const formsLine = ft[1] && fc[1] ? t("pr.forms", { a: `${fc[0]}/${fc[1]}`, ap: pct(fc), b: `${ft[0]}/${ft[1]}`, bp: pct(ft) }) : null;
  const formsMean = ft[1] >= 3 && fc[1] >= 3 ? t(pct(ft) >= 80 && pct(fc) >= 80 ? "pr.formsActive" : pct(fc) - pct(ft) >= 20 ? "pr.formsPassive" : pct(ft) >= pct(fc) ? "pr.formsEven" : "pr.formsSlight") : null;
  const errGroups = sm.groups.filter((g) => g.c < g.n).sort((a, b) => (b.n - b.c) - (a.n - a.c) || lvIdx(a.level) - lvIdx(b.level));
  const repYes = sm.repeats.filter((x) => !x.again), repNo = sm.repeats.filter((x) => x.again);
  const gDk = G.filter((x) => x.dk), gHint = G.filter((x) => x.hinted).length;
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

  const timeDetails = (xs: Item[], dk: number) => {
    const s = slow(xs), f = fast(xs), a = avg(xs);
    if (!s.length && !f && !a && !dk) return null;
    return (
      <details className="prdet noprint">
        <summary>{t("pr.timeMore")}</summary>
        <ul className="prlist small mt-2">
          {a && <li>{t("pl.timeAvg", { s: a })}</li>}
          {s.length > 0 && <li>{t("pr.slowest")}: {s.map((x) => `«${x.q.slice(0, 50)}${x.q.length > 50 ? "…" : ""}» — ${fmtSec(x.ms!)}`).join("; ")}</li>}
          {f > 0 && <li className="text-bad">{t("pl.timeFast", { n: f })}</li>}
          {dk > 0 && <li>{t("pr.dkList", { n: dk })}: {xs.filter((x) => x.dk).map((x) => x.topic).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 6).join(", ")}</li>}
        </ul>
      </details>
    );
  };

  const read = texts(d.reading), listen = texts(d.listening);
  const ans: Ans = { id: p.id, d, reveal: p.reveal };
  const total = Object.values(p.tm).reduce((a, b) => a + b, 0);
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

      <section className="card flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 grow prtitle"><Icon name="spark" size="sm" />{t("pl.exTitle")}</h3>
          {total > 0 && <span className="small muted">{t("pr.totalTime", { s: fmtSec(total) })}</span>}
        </div>
        {p.hint !== null && <p className="prsum m-0">{t(p.wsWaiting.writing || p.wsWaiting.speaking ? "pr.sumWait" : "pr.sum", { h: STEPS[p.hint] })}</p>}

        {(G.length > 0 || p.base) && (
          <Block time={time("core")} idle={p.idle.core ? fmtSec(p.idle.core) : null} ans={ans} title={t("pl.part.core")} step={lvName(p.has("core") ? p.steps.core ?? null : null)} answers={G.length ? "core" : undefined}>
            <h4 className="prh">{t("pr.path")}</h4>
            <Lines list={gram} />
            {(formsLine || sm.repeats.length > 0 || gDk.length > 0) && <h4 className="prh">{t("pr.analysis")}</h4>}
            <Lines list={[
              formsLine,
              sm.repeats.length > 0 && t("pr.repeats", { n: sm.repeats.length }) + (repYes.length ? ` ${t("pr.repYes", { list: repYes.map((x) => x.topic).join(", ") })}` : "") + (repNo.length ? ` ${t("pr.repNo", { list: repNo.map((x) => x.topic).join(", ") })}` : ""),
              gDk.length > 0 && t("pr.dk", { n: gDk.length, w: G.filter((x) => !x.ok).length }),
              gHint > 0 && t("pr.hinted", { n: gHint }),
            ]} />
            <Mean text={formsMean} />
            {errGroups.length > 0 ? (
              <div ref={topicsRef} className="prerr">
                <div className="printonly"><b>Placement test · {p.who} · {t("pr.topicsErr")}</b></div>
                <div className="flex flex-wrap items-center gap-2"><h4 className="prh m-0 grow">{t("pr.topicsErr")}</h4><PdfBtn target={topicsRef} /></div>
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
            ) : G.length > 0 && <p className="prmean ok m-0">✓ {t("pr.noTopicErr")}</p>}
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
            {timeDetails(G, gDk.length)}
          </Block>
        )}

        {V.length > 0 && (
          <Block time={time("vocab")} idle={p.idle.vocab ? fmtSec(p.idle.vocab) : null} ans={ans} title={t("pl.part.vocab")} step={lvName(p.steps.vocab ?? null)} answers="vocab">
            <h4 className="prh">{t("pr.path")}</h4>
            <Lines list={[
              t("pr.vLevels", { list: vLv.map((x) => `${x.level} ${x.r[0]}/${x.r[1]} (${t(x.warm ? "pr.vWarm" : x.level === sm.vlevel ? "pr.vMain" : lvIdx(x.level) > lvIdx(sm.vlevel ?? "A1") ? "pr.vUp" : "pr.vDown")})`).join(" · ") }),
              vTyped[1] && vChoice[1] ? t("pr.forms", { a: `${vChoice[0]}/${vChoice[1]}`, ap: pct(vChoice), b: `${vTyped[0]}/${vTyped[1]}`, bp: pct(vTyped) }) : null,
              V.some((x) => x.dk) && t("pr.dk", { n: V.filter((x) => x.dk).length, w: vErr.length }),
            ]} />
            <Mean text={vTyped[1] >= 3 && vChoice[1] >= 3 ? t(pct(vTyped) >= 80 && pct(vChoice) >= 80 ? "pr.vActive" : pct(vChoice) - pct(vTyped) >= 20 ? "pr.vPassive" : "pr.vEven") : null} />
            {vErr.length > 0 ? (
              <div ref={vErrRef} className="prerr">
                <div className="printonly"><b>Placement test · {p.who} · {t("pr.vErr")}</b></div>
                <div className="flex flex-wrap items-center gap-2"><h4 className="prh m-0 grow">{t("pr.vErr")}</h4><PdfBtn target={vErrRef} /></div>
                {vWeakKinds.length > 0 && <p className="small m-0">{t("pr.vKinds")}: {vWeakKinds.map((k) => `${k.name} (${k.level}, ${k.c}/${k.n})`).join("; ")}</p>}
                <div className="tblwrap">
                  <table className="pltable prerrtbl">
                    <thead><tr><th>{t("pr.colLevel")}</th><th>{t("pr.colTask")}</th><th>{t("pr.colGiven")}</th><th>{t("pr.colRight")}</th></tr></thead>
                    <tbody>{vErr.map((x) => <tr key={x.id}><td>{x.level}</td><td>{x.base ? <b>{x.base} · </b> : null}{x.q}<div className="small muted">{x.topic}</div></td><td>{x.dk ? <span className="pill grey">{t("pl.dontKnow")}</span> : <s>{x.given || "—"}</s>}</td><td><b>{x.right}</b></td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            ) : <p className="prmean ok m-0">✓ {t("pr.vNoErr")}</p>}
            {timeDetails(V, V.filter((x) => x.dk).length)}
          </Block>
        )}

        {([["reading", read, p.steps.reading], ["listening", listen, p.steps.listening]] as const).map(([k, list, step]) => list.length > 0 && (
          <Block key={k} time={time(k)} idle={p.idle[k] ? fmtSec(p.idle[k]) : null} ans={ans} title={t(`pl.part.${k}`)} step={lvName(step)} answers={k}>
            <Lines list={[
              ...list.map((x) => t(k === "listening" ? "pr.textL" : "pr.text", { title: x.title, l: x.level, r: `${x.r[0]}/${x.r[1]}`, p: pct(x.r), n: x.plays ?? 0 })),
              list.some((x) => x.dk) && t("pr.dkText", { n: list.reduce((a, x) => a + x.dk, 0) }),
            ]} />
            <Mean text={(() => { const top = [...list].sort((a, b) => lvIdx(b.level) - lvIdx(a.level))[0]; return top ? `${top.level}: ${meanOf(top.r)}` : null; })()} />
          </Block>
        ))}

        {(["writing", "speaking"] as const).map((k) => d[k] && (
          <Block key={k} time={time(k)} idle={p.idle[k] ? fmtSec(p.idle[k]) : null} ans={ans} title={t(`pl.part.${k}`)} step={lvName(p.steps[k] ?? null)}>
            <Lines list={[
              t(k === "writing" ? "pr.wTask" : "pr.sTask", { l: d[k]!.level, n: k === "writing" ? (d.writing!.text.trim() ? d.writing!.text.trim().split(/\s+/).length : 0) : d.speaking!.questions.filter((q) => q.url).length, m: k === "writing" ? `${d.writing!.min}–${d.writing!.max}` : d.speaking!.questions.length }),
              p.wsWaiting[k] ? t("pr.wsWait") : t("pr.wsDone", { r: lvName(p.steps[k]) }),
            ]} />
          </Block>
        ))}
      </section>
    </>
  );
}
