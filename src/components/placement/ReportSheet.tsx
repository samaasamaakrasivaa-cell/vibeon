"use client";
import { LogoMark } from "../Logo";
import { R_SKILL_NAME, R_SKILLS, R_TITLES, type RBlock, type RLang, type RVariant } from "@/lib/placement/report";
import type { ReportDataT } from "@/lib/placement/report-data";

const CRIT_EN: Record<string, string> = { task: "Task achievement", coherence: "Coherence and organisation", vocabulary: "Vocabulary", grammar: "Grammar", fluency: "Fluency and coherence", pronunciation: "Pronunciation" };

/** Лист отчёта: он же — PDF (печать) и страница в кабинете ученика. */
/** answers — отдельный лист «Разбор ответов» (wrongOnly — только ошибки); иначе — отчёт без разбора ответов. */
export function ReportSheet({ r, v, lang, on, texts, answers, wrongOnly }: { r: Pick<ReportDataT, "input" | "d" | "writing" | "speaking" | "date">; v: RVariant; lang: RLang; on: Record<RBlock, boolean>; texts: Record<string, string>; answers?: boolean; wrongOnly?: boolean }) {
  const T = R_TITLES[lang], x = r.input, ru = lang === "ru";
  const date = new Date(r.date).toLocaleDateString(ru ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const txt = (b: RBlock) => on[b] && texts[b]?.trim() && <section className="rpt-b"><h3>{T[b]}</h3><div className="rpt-t">{texts[b]}</div></section>;
  const L = ["A1", "A2", "B1", "B2", "C1"];
  const core = [...L.flatMap((l) => r.d.core.filter((q) => !q.vocab && q.level === l)), ...L.flatMap((l) => r.d.core.filter((q) => q.vocab && q.level === l))];
  return (
    <article className="rpt-sheet">
      <header className="rpt-head">
        <div className="rpt-brand"><LogoMark size={34} /><span>Vibe<b>On</b></span></div>
        <div className="rpt-meta"><b>{answers ? (ru ? "Разбор ответов placement test" : "Placement test answers") : T.report}</b><span>{answers ? (wrongOnly ? (ru ? "Только ошибки" : "Mistakes only") : (ru ? "Все вопросы" : "All questions")) : T[v]} · {date}</span></div>
      </header>
      <div className="rpt-who">
        <div><div className="rpt-name">{x.name || "—"}</div><div className="rpt-sub">{x.teen ? "Placement test Teens" : "Placement test"}</div></div>
        {x.level && <div className="rpt-lvl"><span>{T.level}</span><b>{x.level}</b></div>}
      </div>
      {answers ? null : <>
      {txt("level")}
      {on.skills && (
        <section className="rpt-b"><h3>{T.skills}</h3>
          <div className="rpt-skills">{R_SKILLS.map((k) => <div key={k}><span>{R_SKILL_NAME[lang][k]}</span><b>{x.skills[k] ?? "—"}</b></div>)}</div>
        </section>
      )}
      {txt("strong")}
      {txt("work")}
      {on.grammar && x.families.length > 0 && (
        <section className="rpt-b"><h3>{T.grammar}</h3>
          <table className="rpt-tbl"><tbody>{x.families.map((f) => <tr key={f.id}><td>{f.name}</td><td className="r">{f.c}/{f.n}</td><td className="r">{f.n ? Math.round((f.c / f.n) * 100) : 0}%</td></tr>)}</tbody></table>
        </section>
      )}
      {on.writing && r.writing && (
        <section className="rpt-b"><h3>{T.writing} · {r.writing.level}</h3>
          <p className="rpt-q">{r.writing.prompt_en}</p>
          {r.writing.text ? <div className="rpt-t rpt-quote">{r.writing.text}</div> : <p className="rpt-muted">{ru ? "Ответа нет" : "No answer"}</p>}
          {r.writing.marks.some((m) => m.v !== null) && <table className="rpt-tbl"><tbody>{r.writing.marks.map((m) => <tr key={m.id}><td>{ru ? m.name : CRIT_EN[m.id] ?? m.name}</td><td className="r">{m.v ?? "—"} / 3</td></tr>)}</tbody></table>}
          {r.speaking && r.speaking.marks.some((m) => m.v !== null) && <>
            <h3 className="mt">{ru ? "Говорение" : "Speaking"} · {r.speaking.level}</h3>
            <table className="rpt-tbl"><tbody>{r.speaking.marks.map((m) => <tr key={m.id}><td>{ru ? m.name : CRIT_EN[m.id] ?? m.name}</td><td className="r">{m.v ?? "—"} / 3</td></tr>)}</tbody></table>
          </>}
        </section>
      )}
      {txt("plan")}
      {txt("comment")}
      </>}
      {answers && (() => {
        // нумерация — как в разборе на экране, независимо от фильтра «только ошибки»
        const num = new Map<string, number>(); let k = 0;
        for (const q of core) num.set(q.id, ++k);
        const texts2 = [...r.d.reading, ...r.d.listening];
        for (const t of texts2) for (const q of t.questions) num.set(q.id, ++k);
        const coreRow = (q: (typeof core)[number]) => (
          <li key={q.id} value={num.get(q.id)} className={q.ok ? "ok" : "bad"}>
            <span className="rpt-mark">{q.ok ? "✓" : "✗"}</span>
            <div>{q.base && <b className="rpt-base">{q.base} </b>}{q.q}{q.frame ? <> — {q.frame}</> : null}
              <div className="rpt-ans">{q.ok ? <b>{q.given}</b> : <><s>{q.dk ? "I don't know" : q.given || "—"}</s> → <b>{q.right}</b></>}</div>
              {!q.ok && q.explain && <div className="rpt-expl">{q.explain}</div>}
              <div className="rpt-muted">{q.topic}</div>
            </div>
          </li>
        );
        const part = (title: string, list: typeof core) => { const shown = wrongOnly ? list.filter((q) => !q.ok) : list; return shown.length > 0 && <div className="rpt-text"><h4>{title}</h4><ol className="rpt-list">{shown.map(coreRow)}</ol></div>; };
        const total = num.size, wrong = core.filter((q) => !q.ok).length + texts2.reduce((a, t) => a + t.questions.filter((q) => !q.ok).length, 0);
        return (
          <section className="rpt-b rpt-answers">
            <p className="rpt-muted">{ru ? `Всего вопросов: ${total}, верно: ${total - wrong}, с ошибкой: ${wrong}.` : `Questions: ${total}, correct: ${total - wrong}, mistakes: ${wrong}.`}{wrongOnly ? (ru ? " Ниже — только вопросы с ошибками; номера — как в полном разборе." : " Only questions with mistakes are shown; numbers match the full list.") : ""}</p>
            {part(ru ? "Грамматика" : "Grammar", core.filter((q) => !q.vocab))}
            {part(ru ? "Лексика" : "Vocabulary", core.filter((q) => q.vocab))}
            {texts2.map((t) => {
              const shown = wrongOnly ? t.questions.filter((q) => !q.ok) : t.questions;
              if (!shown.length) return null;
              return (
                <div key={t.id} className="rpt-text">
                  <h4>{t.kind === "reading" ? (ru ? "Чтение" : "Reading") : (ru ? "Аудирование" : "Listening")} · {t.level} · {t.title}</h4>
                  {(t.passage || t.script) && <div className="rpt-t rpt-quote">{t.passage ?? t.script}</div>}
                  <ol className="rpt-list">{shown.map((q) => (
                    <li key={q.id} value={num.get(q.id)} className={q.ok ? "ok" : "bad"}>
                      <span className="rpt-mark">{q.ok ? "✓" : "✗"}</span>
                      <div>{q.q}
                        <div className="rpt-ans">{q.ok ? <b>{q.options[q.answer]}</b> : <><s>{q.dk ? "I don't know" : q.given === null ? "—" : q.options[Number(q.given)]}</s> → <b>{q.options[q.answer]}</b></>}</div>
                        {!q.ok && q.explain && <div className="rpt-expl">{q.explain}</div>}
                      </div>
                    </li>
                  ))}</ol>
                </div>
              );
            })}
          </section>
        );
      })()}
      <footer className="rpt-foot">vibeon.online</footer>
    </article>
  );
}
