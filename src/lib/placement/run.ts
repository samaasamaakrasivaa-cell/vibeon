import "server-only";
import type { Prisma } from "@prisma/client";
import { INSTRUCTIONS } from "./bank";
import {
  checkCore, coreProgress, coreResult, fallbackText, levelOfStep, nextStep, pickCore, pickTask, pickTexts,
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

/** Выдать следующее задание или перейти к следующему разделу. */
export function advance(st: PState, bank: Bank) {
  const snap = (x: AnyItem) => { st.items[x.id] = x; return x.id; };
  const go = (to: PState["section"]) => { if (st.section !== "intro") leave(st, st.section); st.section = to; enter(st, to); };
  for (let guard = 0; guard < 8; guard++) {
    if (st.section === "core") {
      const last = st.core[st.core.length - 1];
      if (last && !st.answers[last.id]) return;
      const s = nextStep(st, bank);
      const it = s === null ? null : pickCore(st, bank, s);
      if (it && s !== null) { snap(it); st.core.push({ id: it.id, step: s }); return; }
      st.step = coreResult(st, bank);
      st.level = levelOfStep(st.step);
      const plus = st.step % 2 === 1 || st.step === 8;
      st.reading = pickTexts(bank.reading, st.level, plus).map(snap);
      go("reading");
      continue;
    }
    if (st.section === "reading" || st.section === "listening") {
      const k = st.section;
      const ids = k === "reading" ? st.reading : st.listening;
      const done = k === "reading" ? st.rdone : st.ldone;
      if (ids.some((id) => !done.includes(id))) return;
      const fb = fallbackText<ReadItem | ListenItem>(k === "reading" ? bank.reading : bank.listening, st, k);
      if (fb) { ids.push(snap(fb)); return; }
      const plus = (st.step ?? 0) % 2 === 1 || st.step === 8;
      if (k === "reading") { st.listening = pickTexts(bank.listening, st.level!, plus).map(snap); go("listening"); continue; }
      const w = pickTask(bank.writing, st.level!, plus);
      if (w) { snap(w); st.writing = { id: w.id, text: "" }; }
      go("writing");
      return;
    }
    return;
  }
}

/** Задание без ответов — то, что уходит в браузер. */
export function publicView(st: PState, lang: "ru" | "en", bank?: Bank) {
  const ins = (k: string) => INSTRUCTIONS[k]?.[lang] ?? "";
  const base = { section: st.section, level: st.level ?? null };
  if (st.section === "core") {
    const last = st.core[st.core.length - 1];
    const it = last ? (st.items[last.id] as CoreItem) : null;
    const progress = bank ? coreProgress(st, bank) : st.pmax ?? 0;
    if (!it) return { ...base, section: "core" as const, n: 0, progress, item: null };
    return {
      ...base, section: "core" as const, n: st.core.length, progress,
      item: { id: it.id, type: it.type, skill: it.skill, q: it.q, options: it.options ?? null, base: it.base ?? null, key: it.key ?? null, frame: it.frame ?? null, instr: ins(it.type) },
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
        : { id: it.id, title: it.title, situation: (it as ListenItem).situation_ru ?? "", audio: (it as ListenItem).audio ?? "", plays: (it as ListenItem).plays ?? 2, used: st.plays[it.id] ?? 0, questions: qs };
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
