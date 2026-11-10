import "server-only";
import type { Prisma } from "@prisma/client";
import { INSTRUCTIONS } from "./bank";
import {
  checkCore, coreProgress, coreResult, fallbackText, levelOfStep, nextCore, nextVocab, pickTask, pickTexts, stepOf, vocabProgress, vocabResult,
  type AnyItem, type Bank, type CoreItem, type ListenItem, type PState, type ReadItem, type SpeakItem, type WriteItem,
} from "./engine";

export const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const stateOf = (v: unknown) => v as PState;

/** Время по разделам: отметка входа и накопленная длительность (с учётом перерывов не считаем паузы дольше 20 минут). */
export function enter(st: PState, sec: string) { st.times = { ...(st.times ?? {}), [`${sec}At`]: Date.now() }; }
export function leave(st: PState, sec: string) {
  const at = st.times?.[`${sec}At`];
  if (at) st.times = { ...st.times, [sec]: (st.times?.[sec] ?? 0) + Math.min(Date.now() - at, 3 * 3600e3), [`${sec}At`]: 0 };
}

/** Разделы после ядра: между незавершёнными можно свободно переключаться. */
export const LATER = ["reading", "listening", "writing", "speaking"] as const;
export type Later = (typeof LATER)[number];
export function closedOf(st: PState): string[] {
  if (st.closed) return st.closed;
  const i = LATER.indexOf(st.section as Later); // старые прохождения: всё до текущего раздела закрыто
  return i > 0 ? [...LATER.slice(0, i)] : st.section === "done" ? [...LATER] : [];
}
export const openOf = (st: PState) => LATER.filter((x) => !closedOf(st).includes(x));
export function goTo(st: PState, to: PState["section"]) {
  if (st.section !== "intro" && st.section !== to) leave(st, st.section);
  if (st.section !== to) { st.section = to; enter(st, to); }
}
/** Закрыть раздел; true — открытых не осталось (тест можно отправлять). */
export function closeSection(st: PState, sec: Later, bank: Bank) {
  st.closed = [...new Set([...closedOf(st), sec])];
  const next = openOf(st)[0];
  if (!next) { leave(st, st.section); return true; }
  ensureTasks(st, bank);
  goTo(st, next);
  return false;
}
/** Задания всех разделов после ядра выбираются сразу — чтобы ученик мог переключаться между ними. */
function ensureTasks(st: PState, bank: Bank) {
  const snap = (x: AnyItem) => { st.items[x.id] = x; return x.id; };
  const ts = Math.min(st.step ?? 0, st.vstep ?? 8); // тексты — по меньшему из грамматики и лексики
  const plus = ts % 2 === 1 || ts === 8;
  const L = st.level ?? "A1";
  if (!st.reading.length) st.reading = pickTexts(bank.reading, L, plus).map(snap);
  if (!st.listening.length) st.listening = pickTexts(bank.listening, L, plus).map(snap);
  if (!st.writing) { const w = pickTask(bank.writing, L, plus); if (w) st.writing = { id: snap(w), text: "" }; }
  if (!st.speaking) { const sp = pickTask(bank.speaking, L, plus); if (sp) st.speaking = { id: snap(sp), rec: {} }; }
}

/** Выдать следующее задание грамматики или лексики; когда лексика закончена — открыть остальные разделы. */
export function advance(st: PState, bank: Bank) {
  const snap = (x: AnyItem) => { st.items[x.id] = x; return x.id; };
  if (st.section !== "core" && st.section !== "vocab") { ensureTasks(st, bank); return; }
  const last = st.core[st.core.length - 1];
  if (last && !st.answers[last.id]) return;
  if (st.section === "core") {
    const nx = nextCore(st, bank);
    if (nx) { snap(nx.item); st.core.push({ id: nx.item.id, step: stepOf(nx.item.level, nx.item.band), ph: nx.ph }); return; }
    st.step = coreResult(st, bank);
    goTo(st, "vocab");
  }
  const nv = nextVocab(st, bank);
  if (nv) { snap(nv.item); st.core.push({ id: nv.item.id, step: stepOf(nv.item.level, nv.item.band), ph: nv.ph }); return; }
  st.vstep = vocabResult(st);
  st.level = levelOfStep(Math.min(st.step ?? 0, st.vstep));
  st.closed = [];
  ensureTasks(st, bank);
  goTo(st, "reading");
}

/** Чтение или аудирование: запасной текст на уровень ниже, если по двум текстам меньше половины верных. */
export function addFallback(st: PState, bank: Bank, k: "reading" | "listening") {
  const fb = fallbackText<ReadItem | ListenItem>(k === "reading" ? bank.reading : bank.listening, st, k);
  if (!fb) return false;
  st.items[fb.id] = fb;
  (k === "reading" ? st.reading : st.listening).push(fb.id);
  return true;
}

/** Задание без ответов — то, что уходит в браузер. */
export function publicView(st: PState, lang: "ru" | "en", bank?: Bank) {
  const ins = (k: string) => INSTRUCTIONS[k]?.[lang] ?? "";
  const base = { section: st.section, level: st.level ?? null, open: st.section === "core" || st.section === "vocab" || st.section === "intro" ? [] : (openOf(st) as string[]) };
  if (st.section === "core" || st.section === "vocab") {
    const sec = st.section;
    const last = st.core[st.core.length - 1];
    const it = last ? (st.items[last.id] as CoreItem) : null;
    const progress = sec === "vocab" ? vocabProgress(st) : bank ? coreProgress(st, bank) : st.pmax ?? 0;
    const from = sec === "vocab" ? st.core.findIndex((x) => x.ph?.startsWith("v")) : 0; // «Предыдущее» — только внутри блока
    if (!it) return { ...base, section: sec, n: 0, from: 0, progress, item: null };
    return {
      ...base, section: sec, n: st.core.length, from: Math.max(0, from), progress,
      item: { id: it.id, type: it.type, skill: it.skill, q: it.q, options: it.options ?? null, base: it.base ?? null, key: it.key ?? null, frame: it.frame ?? null, hint: (it as CoreItem & { hint_ru?: string }).hint_ru ?? null, instr: ins(it.type) },
    };
  }
  if (st.section === "reading" || st.section === "listening") {
    const ids = st.section === "reading" ? st.reading : st.listening;
    const done = st.section === "reading" ? st.rdone : st.ldone;
    // открытые тексты раздела: между ними можно переключаться и менять ответы до «Завершить раздел»
    const items = ids.filter((x) => !done.includes(x)).map((id) => {
      const it = st.items[id] as ReadItem | ListenItem;
      const qs = it.questions.map((q) => ({ id: q.id, q: q.q, options: q.options, v: st.open?.[q.id] ?? null }));
      return it.type === "reading"
        ? { id: it.id, title: it.title, passage: it.passage, questions: qs }
        : { id: it.id, title: it.title, situation: (it as ListenItem & { situation_en?: string }).situation_en ?? (it as ListenItem).situation_ru ?? "", audio: (it as ListenItem).audio ?? "", plays: (it as ListenItem).plays ?? 2, used: st.plays[it.id] ?? 0, questions: qs };
    });
    return { ...base, section: st.section, extra: done.length > 0, instr: ins(st.section), items };
  }
  if (st.section === "writing") {
    const it = st.writing ? (st.items[st.writing.id] as WriteItem) : null;
    return { ...base, section: "writing" as const, instr: ins("writing"), text: st.writing?.text ?? "", item: it && { id: it.id, kind: ((k) => k.charAt(0).toUpperCase() + k.slice(1))(it.topic_ru.replace(/^Письмо:\s*/, "")), prompt_en: it.prompt_en, prompt_ru: it.prompt_ru, points: it.points ?? [], min: it.min_words, max: it.max_words, time: it.time_min } };
  }
  if (st.section === "speaking") {
    const it = st.speaking ? (st.items[st.speaking.id] as SpeakItem) : null;
    return { ...base, section: "speaking" as const, instr: ins("speaking"), rec: Object.keys(st.speaking?.rec ?? {}), item: it && { id: it.id, level: it.level, intro: it.intro_ru, questions: it.questions.map((q) => ({ q: q.q, prep: q.prep_sec, speak: q.speak_sec, audio: q.audio ?? null })) } };
  }
  return { ...base, section: st.section };
}
export type PView = ReturnType<typeof publicView>;

export { checkCore };
