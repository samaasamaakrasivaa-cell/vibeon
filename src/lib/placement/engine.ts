// Вводный тест A1–C1: типы банка, «лесенка» ядра, подбор текстов, проверка ответов и подсказки для учителя.
// Чистые функции без базы — чтобы логику можно было проверить отдельно (scripts/placement-sim.ts).

export const PL_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type PLevel = (typeof PL_LEVELS)[number];
/** Шкала из 9 ступеней — та же, что в маршруте. */
export const STEPS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1"] as const;
export type Sub = (typeof STEPS)[number];

export type Q = { id: string; q: string; options: string[]; answer: number; topic_id: string; checks?: string; explain_ru: string };
type Base = { id: string; level: PLevel; band: number; topic_en: string; topic_ru: string; explain_ru?: string };
export type CoreItem = Base & {
  skill: "grammar" | "vocabulary"; topic_id: string; type: "mcq" | "gap" | "wordform" | "transform" | "brackets";
  q: string; options?: string[]; answer?: number; accept?: string[]; base?: string; key?: string; frame?: string; explain_ru: string;
  group?: string; // группа тем (00_groups.json) — проставляется при загрузке банка
};
export type Group = { id: string; level: PLevel; kind: "grammar" | "vocabulary"; anchor: boolean; name_ru: string; what_ru: string; topics: string[] };
export type ReadItem = Base & { skill: "reading"; type: "reading"; title: string; text_type?: string; passage: string; words?: number; questions: Q[] };
export type ListenItem = Base & {
  skill: "listening"; type: "listening"; title: string; situation_ru?: string; script: string; duration_sec?: number; plays?: number;
  speakers?: { name: string; gender: string; accent: string }[]; questions: Q[]; audio?: string;
};
export type WriteItem = Base & { skill: "writing"; type: "writing"; prompt_en: string; prompt_ru: string; min_words: number; max_words: number; time_min: number; expects: string[]; points?: string[] };
export type SpeakItem = Base & { skill: "speaking"; type: "speaking"; intro_ru: string; questions: { q: string; prep_sec: number; speak_sec: number; audio?: string | null }[]; expects: string[] };
export type AnyItem = CoreItem | ReadItem | ListenItem | WriteItem | SpeakItem;
export type Family = { id: string; name_ru: string; what_ru: string; topics: string[] };
export type Bank = { groups: Group[]; families?: Family[]; core: CoreItem[]; reading: ReadItem[]; listening: ListenItem[]; writing: WriteItem[]; speaking: SpeakItem[] };

export const SECTIONS = ["core", "vocab", "reading", "listening", "writing", "speaking"] as const;
export type Section = (typeof SECTIONS)[number];

export type Ph = "w" | "l" | "d" | "s" | "vw" | "vl" | "vc";
export type Ans = { v: string | number | null; ok: boolean | null; ms?: number; dk?: boolean; h?: boolean }; // dk — «Не знаю», h — открыл подсказку
export type PState = {
  v: 1;
  section: "intro" | Section | "done";
  beginner?: boolean; // старые прохождения
  start?: number; // ступень старта по ожидаемому уровню (учитель отметил при назначении)
  warm?: number; // сколько заданий разминки (A1–A2) в начале, если уровень не отмечен
  pmax?: number; // полоска прогресса ядра не идёт назад
  open?: Record<string, number>; // черновики ответов к текстам и записям — до «Завершить раздел»
  times?: Record<string, number>; // время по разделам, мс
  rerec?: Record<string, number>; // сколько раз перезаписан ответ на вопрос говорения
  items: Record<string, AnyItem>; // снимок выданных заданий (с ответами)
  core: { id: string; step: number; ph?: Ph }[]; // путь: грамматика (разминка, поиск, проверка, срез выше), затем лексика (vw, vl, vc)
  diag?: number; // уровень подробной проверки (0 = A1 … 4 = C1)
  fb?: boolean; // уже переходили на уровень ниже (погорячились)
  up?: boolean; // уже переходили на уровень выше (срез выше сдан уверенно)
  closed?: string[]; // завершённые разделы после ядра (между открытыми можно переключаться)
  answers: Record<string, Ans>; // по id задания ядра и id вопроса чтения/аудирования
  reading: string[]; listening: string[];
  rdone: string[]; ldone: string[]; // тексты и записи, на которые ученик уже ответил
  plays: Record<string, number>;
  writing?: { id: string; text: string };
  speaking?: { id: string; rec: Record<string, string> }; // номер вопроса → ключ записи
  level?: PLevel; step?: number; // level — уровень текстов (меньший из грамматики и лексики), step — итог грамматики
  vstep?: number; // итог лексики
};

/** expected: ожидаемый уровень от учителя (A1 / B1 / B2) — тогда без разминки, поиск начинается с него. */
export const EXPECT = { A1: 0, B1: 2, B2: 3 } as const; // индекс уровня в PL_LEVELS
export type Expect = keyof typeof EXPECT;
export const emptyState = (expected?: Expect | null): PState => ({
  v: 1, section: "intro", items: {}, core: [], answers: {}, reading: [], listening: [], rdone: [], ldone: [], plays: {},
  ...(expected && expected in EXPECT ? { start: EXPECT[expected] } : { warm: WARM.length }),
});
/** Разминка: одно задание A1 и два A2 из опорных групп — они же идут в зачёт этих групп. */
const WARM = [0, 1, 1];

const BASE: Record<PLevel, number> = { A1: 0, A2: 2, B1: 4, B2: 6, C1: 8 };
/** band 1 уровня X → X, band 2 и 3 → X+ (у C1 — всегда C1). */
export const stepOf = (level: PLevel, band: number) => Math.min(8, BASE[level] + (band > 1 ? 1 : 0));
export const levelOfStep = (s: number): PLevel => PL_LEVELS[Math.floor(Math.max(0, Math.min(8, s)) / 2)];
export const subOf = (s: number): Sub => STEPS[Math.max(0, Math.min(8, Math.round(s)))];
export const stepIdx = (sub: string) => STEPS.indexOf(sub as Sub);

const CORE_MAX = 60;
const PER_GROUP = 3; // заданий из каждой группы на подробной проверке
const FALLBACK_AFTER = 9, FALLBACK_BELOW = 0.4; // после 9 заданий меньше 40% — уровень ниже
const SLICE_FROM = 0.8, SLICE_GROUPS = 4, SLICE_PER = 2, UP_FROM = 0.75; // уровень сделан на 80%+ — срез уровня выше; срез на 75%+ — уровень выше целиком

// ───────── Ядро: поиск уровня → подробная проверка по группам ─────────

type Stat = { n: number; c: number };
const stat = (st: PState, f: (it: CoreItem, x: PState["core"][number]) => boolean): Stat => {
  let n = 0, c = 0;
  for (const x of st.core) { const it = st.items[x.id] as CoreItem; if (!it || !f(it, x) || !st.answers[x.id]) continue; n++; if (st.answers[x.id].ok) c++; }
  return { n, c };
};
const anchorOf = (bank: Bank, li: number) => bank.groups.find((g) => g.level === PL_LEVELS[li] && g.anchor)!;
/** Грамматические группы уровня, опорная — первой (лексика проверяется отдельным блоком). */
const groupsOf = (bank: Bank, li: number) =>
  bank.groups.filter((g) => g.level === PL_LEVELS[li] && g.kind === "grammar").sort((a, b) => Number(b.anchor) - Number(a.anchor));
const inGroup = (st: PState, gid: string) => st.core.filter((x) => (st.items[x.id] as CoreItem)?.group === gid).length;

/** Опорная группа уровня: true — пройдена (2 из 3), false — нет, undefined — ещё не ясно. */
function anchorPass(st: PState, bank: Bank, li: number) {
  const g = anchorOf(bank, li);
  const s = stat(st, (it, x) => it.group === g.id && (x.ph === "w" || x.ph === "l"));
  return s.n >= PER_GROUP ? s.c >= 2 : undefined;
}

/** Уровень-кандидат по опорным группам (null — поиск ещё идёт); next — какой уровень проверять дальше. */
function locate(st: PState, bank: Bank): { cand: number | null; next: number | null } {
  let L = st.start ?? 2;
  for (let guard = 0; guard < 10; guard++) {
    const p = anchorPass(st, bank, L);
    if (p === undefined) return { cand: null, next: L };
    if (p) { if (L === 4) return { cand: 4, next: null }; if (anchorPass(st, bank, L + 1) === false) return { cand: L, next: null }; L++; }
    else { if (L === 0) return { cand: 0, next: null }; if (anchorPass(st, bank, L - 1) === true) return { cand: L - 1, next: null }; L--; }
  }
  return { cand: L, next: null };
}

/** pref: easy — простые задания уровня (band 1, сам уровень X), hard — сложные (band 2–3, X+). */
function pickFrom(st: PState, bank: Bank, gid: string, rnd: () => number, pref?: "easy" | "hard"): CoreItem | null {
  const used = new Set(st.core.map((x) => x.id));
  const topics = new Set(st.core.map((x) => (st.items[x.id] as CoreItem | undefined)?.topic_id));
  let pool = bank.core.filter((x) => x.group === gid && !used.has(x.id));
  if (!pool.length) return null;
  const want = pref === "easy" ? pool.filter((x) => x.band === 1) : pref === "hard" ? pool.filter((x) => x.band > 1) : [];
  if (want.length) pool = want;
  const fresh = pool.filter((x) => !topics.has(x.topic_id)); // по возможности — другая тема внутри группы
  if (fresh.length) pool = fresh;
  return pool[Math.floor(rnd() * pool.length)];
}

const levelAcc = (st: PState, li: number) => stat(st, (it, x) => it.level === PL_LEVELS[li] && it.skill === "grammar" && !x.ph?.startsWith("v"));

/** Следующее задание ядра; null — ядро закончено. Отмечает в st этап проверки (diag, fb). */
export function nextCore(st: PState, bank: Bank, rnd: () => number = Math.random): { item: CoreItem; ph: "w" | "l" | "d" | "s" } | null {
  if (st.core.length >= CORE_MAX) return null;
  const warm = st.warm ?? 0;
  if (st.core.length < warm) {
    const it = pickFrom(st, bank, anchorOf(bank, WARM[st.core.length]).id, rnd, "easy");
    if (it) return { item: it, ph: "w" };
  }
  if (st.diag === undefined) {
    const { cand, next } = locate(st, bank);
    if (next !== null) {
      const it = pickFrom(st, bank, anchorOf(bank, next).id, rnd, "easy");
      if (it) return { item: it, ph: "l" };
    }
    st.diag = cand ?? next ?? 2;
  }
  // подробная проверка уровня: по 3 задания из каждой группы, по кругу
  const D = st.diag!;
  const dItems = st.core.filter((x) => x.ph === "d" && (st.items[x.id] as CoreItem)?.level === PL_LEVELS[D]);
  const dAcc = stat(st, (it, x) => x.ph === "d" && it.level === PL_LEVELS[D]);
  if (!st.fb && !st.up && D > 0 && dAcc.n >= FALLBACK_AFTER && dAcc.c / dAcc.n < FALLBACK_BELOW) { st.fb = true; st.diag = D - 1; return nextCore(st, bank, rnd); }
  void dItems;
  const gs = groupsOf(bank, D);
  // по кругу: сначала из каждой группы простое задание, потом два сложных
  for (let round = 1; round <= PER_GROUP; round++) {
    for (const g of gs) {
      if (inGroup(st, g.id) >= round) continue;
      const it = pickFrom(st, bank, g.id, rnd, round === 1 ? "easy" : "hard");
      if (it) return { item: it, ph: "d" };
    }
  }
  // уровень сделан уверенно — короткий срез уровня выше; срез сдан уверенно — проверяем уровень выше полностью
  if (D < 4 && !st.fb && !st.up) {
    const sl = stat(st, (it, x) => x.ph === "s" && it.level === PL_LEVELS[D + 1]);
    if (sl.n >= SLICE_GROUPS * SLICE_PER && sl.c / sl.n >= UP_FROM) { st.up = true; st.diag = D + 1; return nextCore(st, bank, rnd); }
    const acc = levelAcc(st, D);
    if (acc.n && acc.c / acc.n >= SLICE_FROM) {
      const up = groupsOf(bank, D + 1).slice(0, SLICE_GROUPS);
      for (let round = 1; round <= SLICE_PER; round++)
        for (const g of up) {
          if (inGroup(st, g.id) >= round) continue;
          const it = pickFrom(st, bank, g.id, rnd, "easy");
          if (it) return { item: it, ph: "s" };
        }
    }
  }
  return null;
}

// ───────── Лексика: лесенка от уровня грамматики ─────────

const VKINDS = ["v1", "v2", "v3"] as const;
const vGroup = (bank: Bank, li: number, k: string) => bank.groups.find((g) => g.id === `${PL_LEVELS[li].toLowerCase()}-${k}`);
const vStat = (st: PState, li: number, phs: Ph[]) => stat(st, (it, x) => it.level === PL_LEVELS[li] && !!x.ph && phs.includes(x.ph) && it.skill === "vocabulary");
/** Проба уровня: 3 задания (по одному каждого вида; разминка засчитывается). true — 2 из 3;
 * выше уровня грамматики — 3 из 3, чтобы удачная догадка не поднимала лексику. */
function vProbe(st: PState, li: number) {
  const s = vStat(st, li, ["vw", "vl"]);
  return s.n >= 3 ? s.c >= (li > gLevel(st) ? 3 : 2) : undefined;
}
const gLevel = (st: PState) => Math.floor(Math.max(0, Math.min(8, st.step ?? 0)) / 2);
function vLocate(st: PState): { found: number | null; next: number | null } {
  let L = gLevel(st);
  for (let guard = 0; guard < 10; guard++) {
    const p = vProbe(st, L);
    if (p === undefined) return { found: null, next: L };
    if (p) { if (L === 4) return { found: 4, next: null }; if (vProbe(st, L + 1) === false) return { found: L, next: null }; L++; }
    else { if (L === 0) return { found: 0, next: null }; if (vProbe(st, L - 1) === true) return { found: L - 1, next: null }; L--; }
  }
  return { found: L, next: null };
}
const usedKinds = (st: PState, li: number, phs: Ph[]) =>
  st.core.filter((x) => x.ph && phs.includes(x.ph) && (st.items[x.id] as CoreItem)?.level === PL_LEVELS[li]).map((x) => ((st.items[x.id] as CoreItem).group ?? "").split("-")[1]);

/** Следующее задание лексики: 2 разминочных уровнем ниже грамматики, лесенка по 3, на найденном уровне — 6 (по 2 каждого вида). */
export function nextVocab(st: PState, bank: Bank, rnd: () => number = Math.random): { item: CoreItem; ph: Ph } | null {
  const G = gLevel(st), W = Math.max(0, G - 1);
  const vw = st.core.filter((x) => x.ph === "vw").length;
  if (vw < 2 && G > 0) {
    const g = vGroup(bank, W, VKINDS[vw]); const it = g && pickFrom(st, bank, g.id, rnd, "easy");
    if (it) return { item: it, ph: "vw" };
  }
  const { found, next } = vLocate(st);
  if (next !== null) {
    const have = usedKinds(st, next, ["vw", "vl"]);
    for (const k of VKINDS) {
      if (have.includes(k)) continue;
      const g = vGroup(bank, next, k); const it = g && pickFrom(st, bank, g.id, rnd, "easy");
      if (it) return { item: it, ph: "vl" };
    }
    return null;
  }
  if (found === null) return null;
  // подтверждение: к простым заданиям пробы добавляем по два сложных каждого вида (итого 9 на найденном уровне)
  const have = usedKinds(st, found, ["vw", "vl", "vc"]);
  for (const k of VKINDS) {
    if (have.filter((x) => x === k).length >= 3) continue;
    const g = vGroup(bank, found, k); const it = g && pickFrom(st, bank, g.id, rnd, "hard");
    if (it) return { item: it, ph: "vc" };
  }
  return null;
}

/** Итог лексики на найденном уровне X: простые задания (проба) < 60% — ступень ниже; сложные (подтверждение) ≥ 67% — X+; иначе X. */
export function vocabResult(st: PState) {
  const { found } = vLocate(st);
  const F = found ?? gLevel(st), L = PL_LEVELS[F], b = BASE[L];
  if (F === 0 && vProbe(st, 0) === false) return 0;
  const easy = stat(st, (it, x) => it.level === L && it.skill === "vocabulary" && (x.ph === "vw" || x.ph === "vl"));
  const hard = stat(st, (it, x) => it.level === L && it.skill === "vocabulary" && x.ph === "vc");
  const pe = easy.n ? easy.c / easy.n : 0, ph = hard.n ? hard.c / hard.n : 0;
  if (pe < 0.6) return Math.max(0, b - 1);
  if (F === 4) return 8;
  return ph >= 0.67 ? b + 1 : b;
}
export function vocabProgress(st: PState) {
  const done = st.core.filter((x) => x.ph?.startsWith("v") && st.answers[x.id]).length;
  const { found } = vLocate(st);
  const rem = found === null ? 9 : Math.max(0, 9 - vStat(st, found, ["vw", "vl", "vc"]).n);
  return Math.min(0.97, done / Math.max(1, done + rem));
}

/** Итог ядра по шкале из 9 ступеней. На уровне подробной проверки X: простые задания (band 1) — это сам X,
 * сложные (band 2–3) — X+. Простые не взяты (< 60%) — ступень ниже; сложные взяты (≥ 67%) — X+. */
export function coreResult(st: PState, bank: Bank) {
  void bank;
  if (st.diag === undefined) return 0;
  const D = st.diag, L = PL_LEVELS[D], b = BASE[L];
  const easy = stat(st, (it) => it.level === L && it.band === 1 && it.skill === "grammar"), hard = stat(st, (it) => it.level === L && it.band > 1 && it.skill === "grammar");
  const all = levelAcc(st, D);
  const pe = easy.n >= 3 ? easy.c / easy.n : all.n ? all.c / all.n : 0;
  const ph = hard.n ? hard.c / hard.n : 0;
  if (pe < 0.6) return Math.max(0, b - 1);
  if (D === 4) return 8;
  return ph >= 0.67 ? b + 1 : b;
}

/** Доля пройденного ядра — для полоски без цифр. */
export function coreProgress(st: PState, bank: Bank) {
  const done = st.core.filter((x) => st.answers[x.id]).length;
  let rem: number;
  if (st.diag === undefined) rem = Math.max(0, (st.warm ?? 0) - st.core.length) + 4 + groupsOf(bank, st.start ?? 2).length * PER_GROUP - 3;
  else rem = groupsOf(bank, st.diag).reduce((a, g) => a + Math.max(0, PER_GROUP - inGroup(st, g.id)), 0) + (st.diag < 4 && !st.fb ? 3 : 0);
  const p = done / Math.max(1, done + rem);
  st.pmax = Math.max(st.pmax ?? 0, Math.min(0.97, p));
  return st.pmax;
}

// ───────── Чтение, аудирование, письмо, говорение ─────────

const pickBands = <T extends { band: number; id: string }>(list: T[], plus: boolean, n: number, rnd: () => number): T[] => {
  const want = plus ? [2, 3, 2] : [1, 2, 2];
  const out: T[] = [];
  const left = [...list];
  for (const b of want) {
    if (out.length >= n) break;
    const c = left.filter((x) => x.band === b);
    const x = (c.length ? c : left)[Math.floor(rnd() * (c.length || left.length))];
    if (!x) break;
    out.push(x); left.splice(left.indexOf(x), 1);
  }
  return out;
};

/** Тексты (записи) уровня ядра: два; запасной на уровень ниже — если по ним меньше половины верных. */
export function pickTexts<T extends ReadItem | ListenItem>(list: T[], level: PLevel, plus: boolean, rnd: () => number = Math.random) {
  return pickBands(list.filter((x) => x.level === level), plus, 2, rnd);
}
/** Ещё один текст (запись): меньше 50% по двум текстам уровня — уровнем ниже; 85% и больше — уровнем выше. Один раз. */
export function fallbackText<T extends ReadItem | ListenItem>(list: T[], st: PState, kind: "reading" | "listening", rnd: () => number = Math.random): T | null {
  const ids = kind === "reading" ? st.reading : st.listening;
  const level = st.level!;
  const li = PL_LEVELS.indexOf(level);
  if (ids.some((id) => st.items[id]?.level !== level)) return null; // запасной уже давали
  const qs = ids.flatMap((id) => (st.items[id] as T).questions);
  const ok = qs.filter((q) => st.answers[q.id]?.ok).length;
  if (!qs.length) return null;
  const p = ok / qs.length;
  if (p < 0.5 && li > 0) return pickBands(list.filter((x) => x.level === PL_LEVELS[li - 1]), false, 1, rnd)[0] ?? null;
  if (p >= 0.85 && li < 4) return pickBands(list.filter((x) => x.level === PL_LEVELS[li + 1]), false, 1, rnd)[0] ?? null;
  return null;
}
export function pickTask<T extends WriteItem | SpeakItem>(list: T[], level: PLevel, plus: boolean, rnd: () => number = Math.random): T | null {
  const c = list.filter((x) => x.level === level && (plus ? x.band > 1 : x.band === 1));
  const pool = c.length ? c : list.filter((x) => x.level === level);
  return pool[Math.floor(rnd() * pool.length)] ?? null;
}

// ───────── Проверка ответа ─────────

const EXP: [RegExp, string[]][] = [
  [/\bcan't\b/g, ["cannot", "can not"]], [/\bwon't\b/g, ["will not"]], [/\bshan't\b/g, ["shall not"]], [/n't\b/g, [" not"]],
  [/'m\b/g, [" am"]], [/'re\b/g, [" are"]], [/'ve\b/g, [" have"]], [/'ll\b/g, [" will"]], [/'d\b/g, [" had", " would"]], [/\b(it|he|she|that|there|what|who)'s\b/g, ["$1 is", "$1 has"]],
];
export function norm(s: string) {
  return s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, " ").trim().replace(/[.,!?;:]+$/, "").trim();
}
function variants(s: string) {
  let out = new Set([norm(s)]);
  for (const [re, reps] of EXP) {
    const next = new Set<string>();
    for (const v of out) { if (re.test(v)) { re.lastIndex = 0; for (const r of reps) next.add(v.replace(re, r).replace(/\s+/g, " ").trim()); } next.add(v); re.lastIndex = 0; }
    out = next;
  }
  return out;
}
export function checkText(input: string, accept: string[]) {
  const a = variants(input);
  return accept.some((x) => [...variants(x)].some((v) => a.has(v)));
}
export function checkCore(item: CoreItem, v: string | number | null) {
  if (v === null || v === "") return false;
  if (item.type === "mcq") return Number(v) === item.answer;
  return checkText(String(v), item.accept ?? []);
}

// ───────── Сводка для учителя ─────────

export type GroupRes = { id: string; name: string; what: string; kind: "grammar" | "vocabulary"; level: PLevel; c: number; n: number; dk: number };
export type Summary = {
  coreStep: number; level: PLevel; diag: PLevel | null; fb: boolean; up: boolean;
  easy: [number, number]; hard: [number, number]; above: [number, number]; // уровень проверки: простые, сложные задания; срез уровня выше
  anchors: { level: PLevel; c: number; n: number; pass: boolean | undefined }[]; // поиск уровня
  groups: GroupRes[]; // карта тем грамматики: все группы, где были задания
  vstep: number | null; vlevel: PLevel | null; vgroups: GroupRes[]; // лексика: итог, найденный уровень, три вида на нём
  vprobes: { level: PLevel; c: number; n: number; pass: boolean | undefined }[];
  families: { id: string; name: string; what: string; lvl: [number, number]; all: [number, number] }[]; // грамматика по большим разделам: на уровне проверки и всего
  core: Record<string, { grammar: [number, number]; vocabulary: [number, number] }>; // уровень → [верно, всего]
  reading: Record<string, [number, number]>; listening: Record<string, [number, number]>;
  readStep: number | null; listenStep: number | null;
};
export function summarize(st: PState, bank: Bank): Summary {
  const coreStep = st.step ?? coreResult(st, bank);
  const gOf = new Map(bank.groups.flatMap((g) => g.topics.map((t) => [t, g] as const)));
  const groups = new Map<string, GroupRes>();
  const core: Summary["core"] = {};
  for (const x of st.core) {
    const it = st.items[x.id] as CoreItem; const a = st.answers[x.id];
    if (!it || !a) continue;
    const row = (core[it.level] ??= { grammar: [0, 0], vocabulary: [0, 0] });
    row[it.skill][1] += 1; if (a.ok) row[it.skill][0] += 1;
    const g = (it.group && bank.groups.find((x) => x.id === it.group)) || gOf.get(it.topic_id);
    if (!g || g.kind !== "grammar") continue;
    const r = groups.get(g.id) ?? { id: g.id, name: g.name_ru, what: g.what_ru, kind: g.kind, level: g.level, c: 0, n: 0, dk: 0 };
    r.n++; if (a.ok) r.c++; if (a.dk) r.dk++;
    groups.set(g.id, r);
  }
  const anchors = PL_LEVELS.map((l, li) => {
    const g = anchorOf(bank, li);
    const s = stat(st, (it, x) => (it.group ?? gOf.get(it.topic_id)?.id) === g.id && (x.ph === "w" || x.ph === "l"));
    return { level: l, ...s, pass: s.n >= PER_GROUP ? s.c >= 2 : undefined };
  }).filter((x) => x.n > 0);
  const vf = st.vstep !== undefined ? vLocate(st).found : null;
  const vgroups: GroupRes[] = vf === null ? [] : VKINDS.map((k) => {
    const g = vGroup(bank, vf, k)!;
    const r = { id: g.id, name: g.name_ru, what: g.what_ru, kind: "vocabulary" as const, level: g.level, c: 0, n: 0, dk: 0 };
    for (const x of st.core) { const it = st.items[x.id] as CoreItem; const a = st.answers[x.id]; if (!it || !a || it.group !== g.id || !x.ph?.startsWith("v")) continue; r.n++; if (a.ok) r.c++; if (a.dk) r.dk++; }
    return r;
  });
  const vprobes = PL_LEVELS.map((l, li) => { const s2 = vStat(st, li, ["vw", "vl"]); return { level: l, ...s2, pass: s2.n >= 3 ? s2.c >= 2 : undefined }; }).filter((x) => x.n > 0);
  const byLevel = (ids: string[]) => {
    const r: Record<string, [number, number]> = {};
    for (const id of ids) {
      const it = st.items[id] as ReadItem | ListenItem; if (!it) continue;
      const row = (r[it.level] ??= [0, 0]);
      for (const q of it.questions) { row[1] += 1; if (st.answers[q.id]?.ok) row[0] += 1; }
    }
    return r;
  };
  const reading = byLevel(st.rdone), listening = byLevel(st.ldone);
  const order = new Map(bank.groups.map((g, i) => [g.id, i]));
  const famOf = new Map((bank.families ?? []).flatMap((f) => f.topics.map((t) => [t, f.id] as const)));
  const fam = new Map((bank.families ?? []).map((f) => [f.id, { id: f.id, name: f.name_ru, what: f.what_ru, lvl: [0, 0] as [number, number], all: [0, 0] as [number, number] }]));
  const DL = st.diag !== undefined ? PL_LEVELS[st.diag] : null;
  for (const x of st.core) {
    const it = st.items[x.id] as CoreItem; const a = st.answers[x.id];
    if (!it || !a || it.skill !== "grammar" || x.ph?.startsWith("v")) continue;
    const f = fam.get(famOf.get(it.topic_id) ?? ""); if (!f) continue;
    f.all[1]++; if (a.ok) f.all[0]++;
    if (it.level === DL) { f.lvl[1]++; if (a.ok) f.lvl[0]++; }
  }
  return {
    coreStep, level: levelOfStep(coreStep), diag: st.diag !== undefined ? PL_LEVELS[st.diag] : null, fb: !!st.fb, up: !!st.up, anchors,
    ...(() => {
      if (st.diag === undefined) return { easy: [0, 0] as [number, number], hard: [0, 0] as [number, number], above: [0, 0] as [number, number] };
      const L = PL_LEVELS[st.diag], A = PL_LEVELS[st.diag + 1];
      const e = stat(st, (it) => it.level === L && it.band === 1), h = stat(st, (it) => it.level === L && it.band > 1), a = A ? stat(st, (it) => it.level === A) : { n: 0, c: 0 };
      return { easy: [e.c, e.n] as [number, number], hard: [h.c, h.n] as [number, number], above: [a.c, a.n] as [number, number] };
    })(),
    groups: [...groups.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    vstep: st.vstep ?? null, vlevel: vf === null ? null : PL_LEVELS[vf], vgroups, vprobes,
    families: [...fam.values()].filter((f) => f.all[1] > 0),
    core, reading, listening, readStep: skillStep(reading, st.level), listenStep: skillStep(listening, st.level),
  };
}

/** Ступень по чтению/аудированию: ≥ 80% на уровне → X+ (а если дали текст выше и там ≥ 50% — следующий уровень), ≥ 50% → X, иначе — по запасному тексту ниже. */
function skillStep(r: Record<string, [number, number]>, level?: PLevel) {
  if (!level || !r[level]?.[1]) return null;
  const pct = r[level][0] / r[level][1];
  const b = BASE[level];
  const upL = PL_LEVELS[PL_LEVELS.indexOf(level) + 1], ur = upL ? r[upL] : undefined;
  if (pct >= 0.8 && ur?.[1]) return ur[0] / ur[1] >= 0.5 ? BASE[upL] : Math.min(8, b + 1);
  if (pct >= 0.8) return Math.min(8, b + 1);
  if (pct >= 0.5) return b;
  const li = PL_LEVELS.indexOf(level);
  if (li === 0) return 0;
  const lower = PL_LEVELS[li - 1], lr = r[lower];
  if (lr?.[1]) return lr[0] / lr[1] >= 0.5 ? BASE[lower] + 1 : BASE[lower];
  return Math.max(0, b - 1);
}

/** Подсказка по критериям письма или говорения: среднее вниз, не выше слабого критерия больше чем на две ступени. */
export function rubricHint(steps: (number | null | undefined)[], taskStep?: number | null) {
  const xs = steps.filter((x): x is number => typeof x === "number" && x >= 0);
  if (!xs.length) return null;
  let h = Math.floor(xs.reduce((a, b) => a + b, 0) / xs.length);
  h = Math.min(h, Math.min(...xs) + 2);
  if (typeof taskStep === "number" && taskStep >= 0) h = Math.min(h, taskStep);
  return h;
}

/** Баллы 0–3 по критериям письма или говорения (относительно уровня задания) → ступень.
 * Сумма из 12: 11–12 → X+, 8–10 → X, 5–7 → ступень ниже, 0–4 → уровень ниже. Задача не выполнена (0–1) — не выше ступени ниже. */
export function scoreStep(scores: (number | null | undefined)[], level: PLevel, task?: number | null) {
  const xs = scores.filter((x): x is number => typeof x === "number");
  if (xs.length < scores.length || !xs.length) return null;
  const sum = (xs.reduce((a, b) => a + b, 0) / xs.length) * 4; // к шкале из 12 при любом числе критериев
  const b = BASE[level];
  let r = sum >= 11 ? Math.min(8, b + 1) : sum >= 8 ? b : sum >= 5 ? b - 1 : b - 2;
  if (typeof task === "number" && task <= 1) r = Math.min(r, b - 1);
  return Math.max(0, r);
}

/** Подсказка итога: медиана ступеней по навыкам (вниз). Итог всё равно выбирает учитель. */
export function finalHint(parts: (number | null | undefined)[]) {
  const xs = parts.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.floor((xs.length - 1) / 2)];
}

export const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
