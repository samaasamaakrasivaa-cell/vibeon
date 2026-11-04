"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { addMyWord, deleteMyWord, practiceResult, setWordGoal, updateMyWord } from "@/lib/student/actions";
import { dictationGrade, shuffle } from "@/lib/tasks/parse";

export type W = { id: string; word: string; translation: string | null; example: string | null; ownExample: string | null; level: number; due: boolean };
type Props = { words: W[]; goal: number; days: number[]; remindAt: string; doneToday: number; week: { label: string; done: boolean; planned: boolean; today: boolean }[]; streak: number; train: "today" | "all" | null; tab: "overview" | "list" };

const say = (w: string, lang: string) => { if (typeof window === "undefined" || !("speechSynthesis" in window)) return; const u = new SpeechSynthesisUtterance(w); u.lang = lang; u.rate = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); };

export function WordsView(p: Props) {
  const { t } = useT();
  const [accent, setAccent] = useState("en-GB");
  const [goalOpen, setGoalOpen] = useState(false);
  if (p.train) return <Trainer {...p} accent={accent} />;
  const learned = p.words.filter((w) => w.level >= 4).length;
  const due = p.words.filter((w) => w.due && w.level < 4).length;
  const left = Math.max(0, p.goal - p.doneToday);
  const circ = 2 * Math.PI * 56;
  const daysDone = p.week.filter((d) => d.done && d.planned).length, daysPlanned = p.week.filter((d) => d.planned).length;
  const dayNames = [t("wd.mon"), t("wd.tue"), t("wd.wed"), t("wd.thu"), t("wd.fri"), t("wd.sat"), t("wd.sun")];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1>{t("nav.words")}</h1>
        <div className="seg"><button aria-pressed={accent === "en-GB"} onClick={() => setAccent("en-GB")}>{t("wd.british")}</button><button aria-pressed={accent === "en-US"} onClick={() => setAccent("en-US")}>{t("wd.american")}</button></div>
      </div>
      <nav className="tabsbar fit mb-5">
        <Link href="/student/words" aria-current={p.tab === "overview" ? "page" : undefined}>{t("wd.overview")}</Link>
        <Link href="/student/words?tab=list" aria-current={p.tab === "list" ? "page" : undefined}>{t("wd.myWords")} ({p.words.length})</Link>
      </nav>
      {p.tab === "overview" ? (
        <>
          <section className="card flex flex-wrap items-center gap-6">
            <svg className="goalring" viewBox="0 0 132 132" aria-hidden="true">
              <defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#34C759" /><stop offset="1" stopColor="#0A84FF" /></linearGradient></defs>
              <circle cx="66" cy="66" r="56" fill="none" stroke="var(--fill)" strokeWidth="13" />
              <circle cx="66" cy="66" r="56" fill="none" stroke="url(#gr)" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${(circ * Math.min(p.doneToday, p.goal)) / p.goal} ${circ}`} transform="rotate(-90 66 66)" />
              <text x="66" y="70" textAnchor="middle" fontSize="34" fontWeight="700" fill="var(--text)">{Math.min(p.doneToday, p.goal)}</text>
              <text x="66" y="92" textAnchor="middle" fontSize="13" fill="var(--text2)">{t("wd.of", { n: p.goal })}</text>
            </svg>
            <div className="flex-1 min-w-[220px]">
              <div className="small muted">{t("wd.goalToday")}</div>
              <h2 className="mt-1">{left > 0 ? t("wd.left", { n: left }) : t("st.wordsDone")}</h2>
              <div className="mt-3 flex gap-1.5">{p.week.map((d, i) => <span key={i} className={`daydot ${d.done ? "done" : ""} ${!d.planned ? "off" : ""} ${d.today ? "today" : ""}`} title={dayNames[i]}>{dayNames[i][0]}</span>)}</div>
              <p className="mt-3 mb-1">{t("wd.daysThisWeek", { n: daysDone, total: daysPlanned })} {t("wd.reminders", { days: p.days.map((d) => dayNames[d]).join(", "), time: p.remindAt })}</p>
              <button className="btn plain sm" style={{ paddingLeft: 0 }} onClick={() => setGoalOpen(true)}>{t("wd.changeGoal")}</button>
            </div>
          </section>
          <div className="grid-4 mt-4">
            <div className="wstat" style={{ borderColor: "#CFE3FF" }}><div className="text-[26px]">📚</div><b className="text-accent">{p.words.length}</b><span>{t("wd.inList")}</span></div>
            <div className="wstat" style={{ borderColor: "#CDEFD6" }}><div className="text-[26px]">👑</div><b className="text-ok">{learned}</b><span>{t("wd.learned")}</span></div>
            <div className="wstat" style={{ borderColor: "#FFE3B8" }}><div className="text-[26px]">💪</div><b className="text-warn">{p.words.length - learned}</b><span>{t("wd.inTraining")}</span></div>
            <div className="wstat" style={{ borderColor: "#FFD0CC" }}><div className="text-[26px]">🔥</div><b className="text-bad">{p.streak}</b><span>{t("wd.streak")}</span></div>
          </div>
          <div className="grid-2 mt-4">
            <Link href="/student/words?train=today" className="traincard primary"><Icon name="cards" size="lg" /><span className="grow"><b>{t("wd.train")}</b><small>{t("wd.forToday", { n: Math.max(due ? Math.min(due, Math.max(left, 5)) : 0, 0) })}</small></span><Icon name="right" /></Link>
            <Link href="/student/words?train=all" className="traincard plain"><span className="text-accent">↻</span><span className="grow"><b>{t("cls.trainAll")}</b><small className="muted">{t("wd.allSub")}</small></span><Icon name="right" /></Link>
          </div>
        </>
      ) : <WordList words={p.words} accent={accent} />}
      {goalOpen && <GoalDialog p={p} onClose={() => setGoalOpen(false)} />}
    </>
  );
}

function GoalDialog({ p, onClose }: { p: Props; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [goal, setGoal] = useState(p.goal);
  const [days, setDays] = useState(p.days);
  const [time, setTime] = useState(p.remindAt);
  const [pending, start] = useTransition();
  const dayNames = [t("wd.mon"), t("wd.tue"), t("wd.wed"), t("wd.thu"), t("wd.fri"), t("wd.sat"), t("wd.sun")];
  return (
    <Dialog open onClose={onClose} title={t("wd.changeGoal")}>
      <div className="flex flex-col gap-4">
        <div className="field"><span className="flabel">{t("wd.perDay")}</span><div className="seg">{[5, 10, 15, 20].map((g) => <button key={g} aria-pressed={goal === g} onClick={() => setGoal(g)}>{g}</button>)}</div></div>
        <div className="field"><span className="flabel">{t("wd.days")}</span><div className="flex flex-wrap gap-1.5">{dayNames.map((n, i) => <button key={i} className={`pchip ${days.includes(i) ? "on" : ""}`} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}>{n}</button>)}</div></div>
        <div className="field"><label htmlFor="rt">{t("wd.remind")}</label><input id="rt" type="time" className="input" style={{ width: 140 }} value={time} onChange={(e) => setTime(e.target.value)} /><span className="hint">{t("wd.remindHint")}</span></div>
      </div>
      <div className="actions"><button className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        <button className="btn primary" disabled={pending} onClick={() => start(async () => { await setWordGoal(goal, days, time); onClose(); })}>{t("common.save")}</button></div>
    </Dialog>
  );
}

function WordList({ words, accent }: { words: W[]; accent: string }) {
  const { t } = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const levels = [t("cls.lv0"), t("cls.lv1"), t("cls.lv2"), t("cls.lv3"), t("cls.lv4")];
  return (
    <section className="card">
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); const [w, tr = "", ex = ""] = q.split(/\s+[—–-]\s+/); if (!w.trim()) return; start(async () => { await addMyWord(w, tr, ex); setQ(""); }); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("cls.addWordPh")} aria-label={t("cls.addWordPh")} />
        <button className="btn primary" disabled={pending || !q.trim()}>{t("cls.addWord")}</button>
      </form>
      {words.length === 0 && <p className="hint">{t("cls.noWords")}</p>}
      <div className="flex flex-col">
        {words.map((w) => (
          <div key={w.id} className="row" style={{ alignItems: "flex-start" }}>
            <button className="iconbtn" style={{ background: "var(--fill)" }} onClick={() => say(w.word, accent)} aria-label={t("tk.listen")}><Icon name="sound" size="sm" /></button>
            <div className="grow">
              <b className="block">{w.word}</b><span className="small muted">{w.translation}</span>
              {w.example && <div className="small mt-1"><i>{w.example}</i></div>}
              <input className="input mt-2" style={{ fontSize: 13, padding: "6px 10px" }} defaultValue={w.ownExample ?? ""} placeholder={t("tk.ownExample")} onBlur={(e) => e.target.value !== (w.ownExample ?? "") && updateMyWord(w.id, { ownExample: e.target.value })} aria-label={t("tk.ownExample")} />
            </div>
            <div className="text-right"><div className="flex justify-end gap-1">{[0, 1, 2, 3].map((i) => <i key={i} className="lvl" style={{ background: w.level > i ? "var(--accent)" : "var(--fill)" }} />)}</div><span className="small muted">{levels[w.level]}</span></div>
            <button className="iconbtn" aria-label={t("common.delete")} onClick={() => confirm(t("wd.delQ", { w: w.word })) && start(async () => { await deleteMyWord(w.id); })}>✕</button>
          </div>
        ))}
      </div>
    </section>
  );
}

type Card = { w: W; mode: "flash" | "choose" | "write" | "listen" };

function Trainer(p: Props & { accent: string }) {
  const { t } = useT();
  const router = useRouter();
  const queue = useMemo<Card[]>(() => {
    const pool = p.train === "all" ? shuffle(p.words, "all" + p.words.length).slice(0, 20) : p.words.filter((w) => w.due && w.level < 4).slice(0, Math.max(5, p.goal - p.doneToday));
    return pool.map((w) => {
      const canText = !!w.translation;
      const mode = !canText ? "flash" : (["flash", "choose", "write", "listen", "listen"] as const)[w.level];
      return { w, mode };
    });
  }, [p.words, p.train, p.goal, p.doneToday]);
  const [i, setI] = useState(0);
  const [right, setRight] = useState(0);
  const [state, setState] = useState<"ask" | "ok" | "bad" | "spell">("ask");
  const [flip, setFlip] = useState(false);
  const [v, setV] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const card = queue[i];
  if (!queue.length)
    return (
      <section className="card text-center">
        <div className="text-[44px]">🎉</div><h2>{t("wd.nothingDue")}</h2><p className="muted">{t("wd.nothingDueSub")}</p>
        <div className="flex justify-center gap-2"><Link className="btn secondary" href="/student/words">{t("common.back")}</Link><Link className="btn primary" href="/student/words?train=all">{t("cls.trainAll")}</Link></div>
      </section>
    );
  if (!card)
    return (
      <section className="card text-center">
        <div className="text-[44px]">🔥</div><h2>{t("wd.finished")}</h2><p className="muted">{t("wd.score", { n: right, total: queue.length })}</p>
        <div className="flex justify-center gap-2"><button className="btn secondary" onClick={() => { router.push("/student/words"); router.refresh(); }}>{t("wd.toWords")}</button><button className="btn primary" onClick={() => { setI(0); setRight(0); setState("ask"); router.refresh(); }}>{t("wd.again")}</button></div>
      </section>
    );
  const answer = async (ok: boolean) => {
    setState(ok ? "ok" : "bad");
    if (ok) setRight((r) => r + 1);
    await practiceResult(card.w.id, ok);
  };
  const next = () => { setI(i + 1); setState("ask"); setFlip(false); setV(""); setPicked(null); };
  const options = card.mode === "choose" ? shuffle([card.w.translation!, ...shuffle(p.words.filter((x) => x.id !== card.w.id && x.translation).map((x) => x.translation!), card.w.id).slice(0, 3)], card.w.id + "o") : [];
  return (
    <section className="card">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/student/words" className="iconbtn" aria-label={t("common.back")}><Icon name="close" size="sm" /></Link>
        <span className="hwbar"><i style={{ width: `${(i / queue.length) * 100}%` }} /></span>
        <span className="small font-semibold">{i + 1}/{queue.length}</span>
      </div>
      <div className="small mb-2 text-center text-text3">{t(`wd.mode.${card.mode}` as never)}</div>
      {card.mode === "flash" && (
        <>
          <div className="flash" onClick={() => setFlip(true)}>
            <div className="w">{card.w.word}</div>
            <button className="iconbtn" onClick={(e) => { e.stopPropagation(); say(card.w.word, p.accent); }} aria-label={t("tk.listen")}><Icon name="sound" size="sm" /></button>
            {flip ? <><div className="text-[19px]">{card.w.translation ?? "—"}</div>{card.w.example && <i className="small muted">{card.w.example}</i>}</> : <span className="hint">{t("wd.tapToFlip")}</span>}
          </div>
          {state === "ask" ? (
            <div className="mt-4 grid grid-cols-2 gap-3"><button className="btn secondary lg" onClick={() => answer(false).then(next)}>{t("wd.dontKnow")}</button><button className="btn primary lg" onClick={() => answer(true).then(next)}>{t("wd.know")}</button></div>
          ) : null}
        </>
      )}
      {card.mode === "choose" && (
        <>
          <div className="flash" style={{ minHeight: 150 }}><div className="w">{card.w.word}</div></div>
          <div className="opts mt-4">
            {options.map((o) => <button key={o} disabled={state !== "ask"} className={state !== "ask" ? (o === card.w.translation ? "ok" : o === picked ? "bad" : "") : ""} onClick={() => { setPicked(o); answer(o === card.w.translation); }}>{o}</button>)}
          </div>
        </>
      )}
      {(card.mode === "write" || card.mode === "listen") && (
        <>
          <div className="flash" style={{ minHeight: 150 }}>
            {card.mode === "write" ? <div className="text-[24px] font-semibold">{card.w.translation}</div> : <button className="btn primary lg" onClick={() => say(card.w.word, p.accent)}><Icon name="sound" />{t("tk.listen")}</button>}
          </div>
          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (state !== "ask") return next(); const g = dictationGrade(v, card.w.word); setState(g === "exact" ? "ok" : g === "spelling" ? "spell" : "bad"); if (g === "exact") setRight((r) => r + 1); practiceResult(card.w.id, g === "exact"); }}>
            <input className={`input tk-line ${state === "ok" ? "ok" : state === "spell" ? "spell" : state === "bad" ? "bad" : ""}`} value={v} onChange={(e) => setV(e.target.value)} placeholder={t("wd.typeWord")} autoFocus aria-label={t("wd.typeWord")} />
            <button className="btn primary">{state === "ask" ? t("tk.check") : t("wd.next")}</button>
          </form>
        </>
      )}
      {state !== "ask" && card.mode !== "flash" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className={state === "ok" ? "text-ok font-semibold" : "text-bad"}>{state === "ok" ? `✓ ${t("tk.allRight")}` : `${t("wd.correct")}: ${card.w.word} — ${card.w.translation}`}</span>
          {card.mode === "choose" && <button className="btn primary" onClick={next}>{t("wd.next")}</button>}
        </div>
      )}
    </section>
  );
}
