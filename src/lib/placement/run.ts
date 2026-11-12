import "server-only";
import type { Prisma } from "@prisma/client";
import { instruction, instructionRu, trackOf } from "./bank";
import {
  checkCore, coreProgress, coreResult, firstText, levelOfStep, wsStep, nextCore, nextText, nextVocab, pickTask, PL_LEVELS, stepOf, textLevel, vocabProgress, vocabResult,
  type AnyItem, type Bank, type CoreItem, type ListenItem, type PState, type ReadItem, type SpeakItem, type WriteItem,
} from "./engine";

export const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const stateOf = (v: unknown) => v as PState;

/** Время по разделам: отметка входа и накопленная длительность (с учётом перерывов не считаем паузы дольше 20 минут). */
export function enter(st: PState, sec: string) { const now = Date.now(); st.times = { ...(st.times ?? {}), [`${sec}At`]: now, [`${sec}Last`]: now }; }
/** Перерыв: между двумя действиями ученика в разделе прошло больше 8 минут — это время не считаем работой. */
const IDLE = 8 * 60e3;
/** Каждое действие ученика (ответ, выбор варианта, прослушивание, черновик письма) — отметка активности в текущем разделе. */
export function touch(st: PState) {
  const sec = st.section, now = Date.now(), t = st.times ?? {};
  if (!t[`${sec}At`]) return;
  const gap = now - (t[`${sec}Last`] || t[`${sec}At`]);
  st.times = { ...t, [`${sec}Last`]: now, ...(gap > IDLE ? { [`${sec}Idle`]: (t[`${sec}Idle`] ?? 0) + gap, [`${sec}Pauses`]: (t[`${sec}Pauses`] ?? 0) + 1 } : {}) };
}
export function leave(st: PState, sec: string) {
  const at = st.times?.[`${sec}At`];
  if (!at) return;
  if (st.section === sec) touch(st);
  st.times = { ...st.times, [sec]: (st.times?.[sec] ?? 0) + Math.min(Date.now() - at, 24 * 3600e3), [`${sec}At`]: 0 };
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
/** Письмо и говорение открываются, когда закончены чтение и аудирование: их уровень считается по этим навыкам. */
export const lockedOf = (st: PState): Later[] => (openOf(st).some((x) => x === "reading" || x === "listening") ? ["writing", "speaking"] : []);
export const availOf = (st: PState) => openOf(st).filter((x) => !lockedOf(st).includes(x));
export function goTo(st: PState, to: PState["section"]) {
  if (st.section !== "intro" && st.section !== to) leave(st, st.section);
  if (st.section !== to) { st.section = to; enter(st, to); }
}
/** Закрыть раздел; true — открытых не осталось (тест можно отправлять). */
export function closeSection(st: PState, sec: Later, bank: Bank) {
  st.closed = [...new Set([...closedOf(st), sec])];
  const next = availOf(st)[0];
  if (!next) { leave(st, st.section); return true; }
  ensureTasks(st, bank);
  goTo(st, next);
  return false;
}
/** Задания всех разделов после ядра выбираются сразу — чтобы ученик мог переключаться между ними. */
export function ensureTasks(st: PState, bank: Bank) {
  const snap = (x: AnyItem) => { st.items[x.id] = x; return x.id; };
  const plus = (st.step ?? 0) % 2 === 1 || st.step === 8;
  const L = st.level ?? "A1";
  if (!st.reading.length) { const x = firstText(bank.reading, L, plus); if (x) st.reading = [snap(x)]; }
  if (!st.listening.length) { const x = firstText(bank.listening, L, plus); if (x) st.listening = [snap(x)]; }
  // письмо и говорение — только когда закончены чтение и аудирование: уровень = средний из трёх навыков
  if (lockedOf(st).length) return;
  const at = (kind: "writing" | "speaking") => { const m = wsStep(st, kind) ?? st.step ?? 0; return { lv: levelOfStep(m), plus: m % 2 === 1 || m === 8 }; };
  if (!st.writing) { const a = at("writing"); const w = pickTask(bank.writing, a.lv, a.plus, Math.random, st.seen ?? []); if (w) st.writing = { id: snap(w), text: "" }; }
  if (!st.speaking) { const a = at("speaking"); const sp = pickTask(bank.speaking, a.lv, a.plus, Math.random, st.seen ?? []); if (sp) st.speaking = { id: snap(sp), rec: {} }; }
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
  st.level = PL_LEVELS[textLevel(st.step ?? 0, st.vstep)];
  st.closed = [];
  ensureTasks(st, bank);
  goTo(st, "reading");
}

/** Чтение или аудирование: следующий текст по результату предыдущего. false — раздел закончен. */
export function addNextText(st: PState, bank: Bank, k: "reading" | "listening") {
  const nx = nextText<ReadItem | ListenItem>(k === "reading" ? bank.reading : bank.listening, st, k);
  if (!nx) return false;
  st.items[nx.id] = nx;
  (k === "reading" ? st.reading : st.listening).push(nx.id);
  return true;
}

/** Задание без ответов — то, что уходит в браузер. */
export function publicView(st: PState, lang: "ru" | "en", bank?: Bank) {
  void lang;
  const track = trackOf(st.track);
  const ins = (k: string, lv?: string) => instruction(k, lv, track);
  const insRu = (k: string, lv?: string) => instructionRu(k, lv, track); // Teens A1–A2: перевод инструкции
  const base = { teen: track === "teen", section: st.section, level: st.level ?? null, open: st.section === "core" || st.section === "vocab" || st.section === "intro" ? [] : (openOf(st) as string[]), locked: lockedOf(st) as string[] };
  if (st.section === "core" || st.section === "vocab") {
    const sec = st.section;
    const last = st.core[st.core.length - 1];
    const it = last ? (st.items[last.id] as CoreItem) : null;
    const progress = sec === "vocab" ? vocabProgress(st, bank) : bank ? coreProgress(st, bank) : st.pmax ?? 0;
    const from = sec === "vocab" ? st.core.findIndex((x) => x.ph?.startsWith("v")) : 0; // «Предыдущее» — только внутри блока
    if (!it) return { ...base, section: sec, n: 0, from: 0, progress, item: null };
    return {
      ...base, section: sec, n: st.core.length, from: Math.max(0, from), progress,
      item: { id: it.id, type: it.type, skill: it.skill, q: it.q, options: it.options ?? null, base: it.base ?? null, key: it.key ?? null, frame: it.frame ?? null, hint: (it as CoreItem & { hint_ru?: string }).hint_ru ?? null, instr: ins(it.type, it.level), instrRu: insRu(it.type, it.level) },
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
    return { ...base, section: st.section, n: done.length + 1, extra: ids.length >= 3, instr: ins(st.section, st.level), instrRu: insRu(st.section, st.level), items };
  }
  if (st.section === "writing") {
    const it = st.writing ? (st.items[st.writing.id] as WriteItem) : null;
    return { ...base, section: "writing" as const, instr: ins("writing", it?.level), instrRu: insRu("writing", it?.level), text: st.writing?.text ?? "", item: it && { id: it.id, kind: ((k) => k.charAt(0).toUpperCase() + k.slice(1))(it.topic_en.replace(/^Writing:\s*/, "")), prompt_en: it.prompt_en, prompt_ru: it.level === "A1" || it.level === "A2" ? it.prompt_ru : "", points_title: (it as WriteItem & { points_title?: string }).points_title ?? "", points: it.points ?? [], min: it.min_words, max: it.max_words, time: it.time_min } };
  }
  if (st.section === "speaking") {
    const it = st.speaking ? (st.items[st.speaking.id] as SpeakItem) : null;
    return { ...base, section: "speaking" as const, instr: ins("speaking", it?.level), instrRu: insRu("speaking", it?.level), rec: Object.keys(st.speaking?.rec ?? {}), peek: st.peek ?? [], item: it && { id: it.id, level: it.level, intro: (it as SpeakItem & { intro_en?: string }).intro_en ?? it.intro_ru, questions: it.questions.map((q) => ({ q: q.q, prep: q.prep_sec, speak: q.speak_sec, audio: q.audio ?? null })) } };
  }
  return { ...base, section: st.section };
}
export type PView = ReturnType<typeof publicView>;

export { checkCore };
