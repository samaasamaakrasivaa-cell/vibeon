"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { addMyWord, deleteMyWord, enrichMyWord, lookupMyWord, practiceResult, setWordGoal, updateMyWord } from "@/lib/student/actions";
import { splitWordExample } from "@/lib/student/word-example";
import { wordTranslations } from "@/lib/student/word-translations";
import { dictationGrade, shuffle } from "@/lib/tasks/parse";
import styles from "./PersonalWordCard.module.css";

export type W = {
  id: string;
  word: string;
  translation: string | null;
  definition: string | null;
  ipa: string | null;
  synonyms: string[] | null;
  meanings: string[];
  canEnrich: boolean;
  enrich: boolean;
  example: string | null;
  ownExample: string | null;
  level: number;
  due: boolean;
};
type Props = { words: W[]; goal: number; days: number[]; remindAt: string; doneToday: number; week: { label: string; done: boolean; planned: boolean; today: boolean }[]; streak: number; train: "today" | "all" | null; tab: "overview" | "list"; editGoal: boolean };

const say = (w: string, lang: string) => { if (typeof window === "undefined" || !("speechSynthesis" in window)) return; const u = new SpeechSynthesisUtterance(w); u.lang = lang; u.rate = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); };

export function WordsView(p: Props) {
  const { t } = useT();
  const router = useRouter();
  const [accent, setAccent] = useState("en-GB");
  if (p.train) return <Trainer {...p} accent={accent} />;
  const learned = p.words.filter((w) => w.level >= 4).length;
  const due = p.words.filter((w) => w.due && w.level < 4).length;
  const left = Math.max(0, p.goal - p.doneToday);
  const circ = 2 * Math.PI * 56;
  const daysDone = p.week.filter((d) => d.done && d.planned).length, daysPlanned = p.week.filter((d) => d.planned).length;
  const dayNames = [t("wd.mon"), t("wd.tue"), t("wd.wed"), t("wd.thu"), t("wd.fri"), t("wd.sat"), t("wd.sun")];
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="seg">
          <Link href="/student/words" aria-current={p.tab === "overview" ? "page" : undefined}>{t("wd.overview")}</Link>
          <Link href="/student/words?tab=list" aria-current={p.tab === "list" ? "page" : undefined}>{t("wd.myWords")} ({p.words.length})</Link>
        </div>
        <div className="seg"><button aria-pressed={accent === "en-GB"} onClick={() => setAccent("en-GB")}>{t("wd.british")}</button><button aria-pressed={accent === "en-US"} onClick={() => setAccent("en-US")}>{t("wd.american")}</button></div>
      </div>
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
              <Link className="btn plain sm pl-0" href="/student/words?goal=1" scroll={false}>{t("wd.changeGoal")}</Link>
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
      {p.editGoal && <GoalDialog p={p} onClose={() => router.replace("/student/words", { scroll: false })} />}
    </>
  );
}

function GoalDialog({ p, onClose }: { p: Props; onClose: () => void }) {
  const { t } = useT();
  const [goal, setGoal] = useState(p.goal);
  const [days, setDays] = useState(p.days);
  const [time, setTime] = useState(p.remindAt);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const dayNames = [t("wd.mon"), t("wd.tue"), t("wd.wed"), t("wd.thu"), t("wd.fri"), t("wd.sat"), t("wd.sun")];
  return (
    <Dialog open onClose={() => { if (!pending) onClose(); }} title={t("wd.changeGoal")}>
      <div className="flex flex-col gap-4">
        <div className="field"><span className="flabel">{t("wd.perDay")}</span><div className="seg">{[5, 10, 15, 20].map((g) => <button key={g} aria-pressed={goal === g} onClick={() => setGoal(g)}>{g}</button>)}</div></div>
        <div className="field"><span className="flabel">{t("wd.days")}</span><div className="flex flex-wrap gap-1.5">{dayNames.map((n, i) => <button key={i} className={`pchip ${days.includes(i) ? "on" : ""}`} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}>{n}</button>)}</div></div>
        <div className="field"><label htmlFor="rt">{t("wd.remind")}</label><input id="rt" type="time" className="input" style={{ width: 140 }} value={time} onChange={(e) => setTime(e.target.value)} /><span className="hint">{t("wd.remindHint")}</span></div>
      </div>
      {error && <p className="small text-bad mb-0" role="alert">{t("wd.goalSaveError")}</p>}
      <div className="actions"><button className="btn secondary" disabled={pending} onClick={onClose}>{t("common.cancel")}</button>
        <button className="btn primary" disabled={pending} onClick={() => start(async () => {
          setError(false);
          try {
            const result = await setWordGoal(goal, days, time);
            if (result.ok) onClose();
            else setError(true);
          } catch {
            setError(true);
          }
        })}>{t("common.save")}</button></div>
    </Dialog>
  );
}

function PersonalWordCard({ word, accent, level, onDelete, onAddSynonym }: {
  word: W;
  accent: string;
  level: string;
  onDelete: () => void;
  onAddSynonym: (word: string, meaning: string) => void;
}) {
  const { t } = useT();
  const area = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof enrichMyWord>> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (suggestSynonyms = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setResult(null);
    try {
      setResult(await enrichMyWord(word.id, suggestSynonyms));
    } catch {
      setResult({ ok: false, error: "unavailable" });
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [word.id]);

  useEffect(() => {
    if (!word.enrich || !area.current) return;
    if (!("IntersectionObserver" in window)) {
      void load();
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      void load();
    });
    observer.observe(area.current);
    return () => observer.disconnect();
  }, [load, word.enrich, word.translation]);

  const completed = result?.ok ? result : null;
  const definition = completed?.definition || word.definition;
  const example = completed?.example || word.example;
  const ipa = completed?.ipa || word.ipa;
  const [chosen, setChosen] = useState("");
  const [alternateResults, setAlternateResults] = useState(() => new Map<string, Awaited<ReturnType<typeof enrichMyWord>>>());
  const [loadingAlternate, setLoadingAlternate] = useState(false);
  const meaning = word.meanings.includes(chosen) ? chosen : word.meanings[0];
  const alternate = meaning && meaning !== word.meanings[0] ? meaning : null;
  const alternateResult = alternate ? alternateResults.get(alternate) : null;
  const synonyms = alternate ? (alternateResult?.ok ? alternateResult.synonyms : null) : completed?.synonyms ?? word.synonyms;
  const canSuggest = word.canEnrich && synonyms === null && !loading && result?.ok !== false && (!word.enrich || completed);

  const loadAlternate = async (meaning: string) => {
    setLoadingAlternate(true);
    try {
      const details = await enrichMyWord(word.id, true, meaning);
      setAlternateResults((current) => new Map(current).set(meaning, details));
    } catch {
      setAlternateResults((current) => new Map(current).set(meaning, { ok: false, error: "unavailable" }));
    } finally {
      setLoadingAlternate(false);
    }
  };

  return (
    <article className={styles.card} ref={area}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <button type="button" className={`iconbtn ${styles.listen}`} aria-label={t("tk.listen")} onClick={() => say(word.word, accent)}>
            <Icon name="sound" size="sm" />
          </button>
          <div className="min-w-0">
            <h3 className={styles.word} lang="en">{word.word}</h3>
            {ipa && <div className={styles.ipa}>{ipa}</div>}
          </div>
        </div>
        <div className={styles.controls}>
          <div className={styles.progress}>
            <div className="flex justify-end gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <i key={i} className="lvl" style={{ background: word.level > i ? "var(--accent)" : "var(--fill)" }} />)}
            </div>
            <span>{level}</span>
          </div>
          <button type="button" className="iconbtn" aria-label={t("common.delete")} onClick={onDelete}><Icon name="close" size="sm" /></button>
        </div>
      </header>
      {word.translation && <p className={styles.translation} lang="ru">{word.translation}</p>}
      {definition && <p className={styles.detail}><b>{t("wd.cardDefinition")}</b> <span lang="en">{definition}</span></p>}
      {example && (
        <div className={styles.example}>
          <b>{t("wd.cardExample")}</b>
          <p lang="en">{splitWordExample(example, word.word).map((part, i) => i % 2 ? <strong key={i}>{part}</strong> : part)}</p>
        </div>
      )}
      {word.meanings.length > 1 && (
        <label className="field">
          <span className="flabel">{t("wd.synonymMeaningLabel")}</span>
          <select className="select" value={meaning} disabled={loadingAlternate} onChange={(event) => setChosen(event.target.value)}>
            {word.meanings.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
      )}
      {meaning && !!synonyms?.length && (
        <div>
          <p className={styles.detail}>
            <b>{word.meanings.length > 1 ? t("wd.cardSynonymsFor", { meaning }) : t("wd.cardSynonyms")}</b>{" "}
            <span lang="en">{synonyms.join(", ")}</span>
          </p>
          <details className="mt-1">
            <summary className={styles.suggest}>{t("wd.pickSynonym")}</summary>
            <ul className="mt-1 flex flex-wrap gap-2">
              {synonyms.map((synonym) => (
                <li key={synonym}>
                  <button type="button" className="btn secondary sm" aria-label={t("cls.dictAdd", { translation: synonym })}
                    onClick={() => onAddSynonym(synonym, meaning)}><span lang="en">{synonym}</span> +</button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {alternate && (loadingAlternate ? (
        <p className="small muted m-0" role="status">{t("wd.cardLoading")}</p>
      ) : alternateResult?.ok && !synonyms?.length ? (
        <p className="small muted m-0" role="status">{t("wd.noSynonyms")}</p>
      ) : synonyms === null && (
        <div className="flex flex-wrap items-center gap-x-2">
          {alternateResult && !alternateResult.ok && <span className="small muted" role="status">
            {t(alternateResult.error === "limit" ? "wd.cardLimit" : "wd.cardUnavailable")}
          </span>}
          <button type="button" className={styles.suggest} onClick={() => void loadAlternate(alternate)}>
            {t(alternateResult ? "wd.cardRetry" : "wd.cardSuggestSynonyms")}
          </button>
        </div>
      ))}
      {loading && <p className="small muted m-0" role="status">{t("wd.cardLoading")}</p>}
      {result && !result.ok && (
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="small muted" role="status">{t(result.error === "limit" ? "wd.cardLimit" : "wd.cardUnavailable")}</span>
          <button type="button" className="btn plain sm" onClick={() => void load(true)}>{t("wd.cardRetry")}</button>
        </div>
      )}
      {!alternate && canSuggest && (
        <button type="button" className={styles.suggest} onClick={() => void load(true)}>{t("wd.cardSuggestSynonyms")}</button>
      )}
      <label className={styles.ownExample}>
        <span>{t("tk.ownExample")}</span>
        <input className="input" defaultValue={word.ownExample ?? ""} lang="en"
          onBlur={(e) => e.target.value !== (word.ownExample ?? "") && updateMyWord(word.id, { ownExample: e.target.value })} />
      </label>
    </article>
  );
}

function WordList({ words, accent }: { words: W[]; accent: string }) {
  const { t } = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [showDefinition, setShowDefinition] = useState(false);
  const [definition, setDefinition] = useState("");
  const [lookup, setLookup] = useState<Awaited<ReturnType<typeof lookupMyWord>> | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const lookupRequest = useRef(0);
  const [notice, setNotice] = useState<"wd.wordExists" | "wd.translationUpdated" | "wd.wordSaveError" | null>(null);
  const [confirmation, setConfirmation] = useState<(Extract<Awaited<ReturnType<typeof addMyWord>>, { status: "confirm" }> & { preserveDraft: boolean }) | null>(null);
  const [pending, start] = useTransition();
  const levels = [t("cls.lv0"), t("cls.lv1"), t("cls.lv2"), t("cls.lv3"), t("cls.lv4")];
  const [word, translation = "", example = ""] = q.split(/\s+[—–-]\s+/);
  const manual = Boolean(translation.trim() || example.trim() || definition.trim());
  const options = lookup && "translations" in lookup ? lookup.translations : [];
  const lookupMessage = lookup && "error" in lookup
    ? t(lookup.error === "input" ? "cls.dictInput" : lookup.error === "limit" ? "cls.dictLimit" : "cls.dictUnavailable")
    : lookup && !options.length ? t("cls.dictEmpty") : null;

  const search = async (query: string) => {
    const request = ++lookupRequest.current;
    setLookup(null);
    setNotice(null);
    setLookingUp(true);
    try {
      const result = await lookupMyWord(query);
      if (request === lookupRequest.current) setLookup(result);
    } catch {
      if (request === lookupRequest.current) setLookup({ error: "unavailable" });
    } finally {
      if (request === lookupRequest.current) setLookingUp(false);
    }
  };

  const saveWord = (word: string, translation: string, example: string, options?: {
    existing?: NonNullable<typeof confirmation>["existing"];
    definition?: string;
    preserveDraft?: boolean;
  }) => {
    const { existing, definition: suppliedDefinition, preserveDraft = false } = options ?? {};
    setNotice(null);
    start(async () => {
      try {
        const result = await addMyWord(word, translation, example, { definition: suppliedDefinition, confirmation: existing });
        if (result.status === "confirm") {
          setConfirmation({ ...result, preserveDraft });
          return;
        }
        setConfirmation(null);
        if (result.status === "existing") setNotice("wd.wordExists");
        if (result.status === "updated") setNotice("wd.translationUpdated");
        if (result.status === "empty" || result.status === "changed") setNotice("wd.wordSaveError");
        if (!preserveDraft && (result.status === "added" || result.status === "updated")) {
          setQ("");
          setDefinition("");
          setShowDefinition(false);
          setLookup(null);
        }
      } catch {
        setConfirmation(null);
        setNotice("wd.wordSaveError");
      }
    });
  };
  const current = confirmation ? wordTranslations(confirmation.existing.translation).join("; ") : "";
  return (
    <div className={styles.layout}>
      <section className="card">
        <form className="flex flex-col gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (pending || lookingUp || !word.trim()) return;
          if (manual) saveWord(word, translation, example, { definition });
          else void search(word);
        }}>
          <div className="flex gap-2">
            <input className="input min-w-0" value={q} disabled={pending} placeholder={t("cls.dictPh")} aria-label={t("cls.dictPh")}
              aria-describedby="my-word-format" onChange={(e) => {
                lookupRequest.current++;
                setQ(e.target.value);
                setLookup(null);
                setLookingUp(false);
                setNotice(null);
              }} />
            <button type="submit" className="btn primary" disabled={pending || lookingUp || !word.trim()}>{t(manual ? "cls.addWord" : "cls.dictSearch")}</button>
          </div>
          <button type="button" className="btn plain sm self-start" disabled={pending} aria-expanded={showDefinition}
            onClick={() => { setShowDefinition(!showDefinition); if (showDefinition) setDefinition(""); }}>
            {t(showDefinition ? "wd.hideDefinitionInput" : "wd.showDefinitionInput")}
          </button>
          {showDefinition && <label className="field">
            <span className="flabel">{t("wd.cardDefinition")}</span>
            <textarea className="textarea" value={definition} maxLength={400} rows={2} disabled={pending} lang="en"
              onChange={(event) => setDefinition(event.target.value)} />
          </label>}
        </form>
        <p className="hint mt-2 mb-4" id="my-word-format">{t("wd.wordManualHint")}</p>
        {(lookingUp || lookupMessage) && <p className="small mb-2 mt-0" role="status">{lookingUp ? t("cls.dictLoading") : lookupMessage}</p>}
        {options.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2">
            {options.map((option) => (
              <li key={option} className="flex items-center justify-between gap-2">
                <span>{option}</span>
                <button type="button" className="iconbtn wplus" disabled={pending} aria-label={t("cls.dictAdd", { translation: option })}
                  onClick={() => saveWord(word, option, "", { definition })}><Icon name="plus" size="sm" /></button>
              </li>
            ))}
          </ul>
        )}
        {lookupMessage && (
          <button type="button" className="btn plain sm mb-4" disabled={pending}
            onClick={() => saveWord(word, "", "", { definition })}>{t("wd.wordWithoutTranslation")}</button>
        )}
        {notice && <p className="small mb-4 mt-0" role="status">{t(notice)}</p>}
        {confirmation && (
          <Dialog key={JSON.stringify([confirmation.existing.id, confirmation.existing.translation])}
            open onClose={() => { if (!pending) setConfirmation(null); }} title={t("wd.updateTranslation")}>
            <p className="m-0 break-words">{t("wd.addTranslation", { word: confirmation.existing.word, value: confirmation.value })}</p>
            {current && <p className="small muted mt-2 mb-0 break-words">{t("wd.currentTranslation", { value: current })}</p>}
            <div className="actions">
              <button type="button" className="btn secondary" disabled={pending} onClick={() => setConfirmation(null)}>{t("common.cancel")}</button>
              <button type="button" className="btn primary" disabled={pending} onClick={() => saveWord(confirmation.existing.word, confirmation.value, "", { existing: confirmation.existing, preserveDraft: confirmation.preserveDraft })}>
                {t("wd.updateTranslation")}
              </button>
            </div>
          </Dialog>
        )}
        {words.length === 0 && <p className="hint mb-0">{t("cls.noWords")}</p>}
      </section>
      {words.length > 0 && <div className={styles.list}>
        {words.map((w) => (
          <PersonalWordCard key={w.id} word={w} accent={accent} level={levels[w.level]}
            onAddSynonym={(synonym, meaning) => { if (!pending) saveWord(synonym, meaning, "", { preserveDraft: true }); }}
            onDelete={() => confirm(t("wd.delQ", { w: w.word })) && start(async () => { await deleteMyWord(w.id); })} />
        ))}
      </div>}
    </div>
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
            {flip ? (
              <>
                {card.w.translation && <div className="text-[19px]">{card.w.translation}</div>}
                {card.w.definition?.trim() && <div className={card.w.translation ? "small" : "text-[19px]"} lang="en">{card.w.definition}</div>}
                {card.w.example && <i className="small muted" lang="en">{card.w.example}</i>}
              </>
            ) : <span className="hint">{t("wd.tapToFlip")}</span>}
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
