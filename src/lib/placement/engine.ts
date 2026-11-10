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
  skill: "grammar" | "vocabulary"; topic_id: string; type: "mcq" | "gap" | "wordform" | "transform";
  q: string; options?: string[]; answer?: number; accept?: string[]; base?: string; key?: string; frame?: string; explain_ru: string;
};
export type ReadItem = Base & { skill: "reading"; type: "reading"; title: string; text_type?: string; passage: string; words?: number; questions: Q[] };
export type ListenItem = Base & {
  skill: "listening"; type: "listening"; title: string; situation_ru?: string; script: string; duration_sec?: number; plays?: number;
  speakers?: { name: string; gender: string; accent: string }[]; questions: Q[]; audio?: string;
};
export type WriteItem = Base & { skill: "writing"; type: "writing"; prompt_en: string; prompt_ru: string; min_words: number; max_words: number; time_min: number; expects: string[]; points?: string[] };
export type SpeakItem = Base & { skill: "speaking"; type: "speaking"; intro_ru: string; questions: { q: string; prep_sec: number; speak_sec: number; audio?: string | null }[]; expects: string[] };
export type AnyItem = CoreItem | ReadItem | ListenItem | WriteItem | SpeakItem;
export type Bank = { core: CoreItem[]; reading: ReadItem[]; listening: ListenItem[]; writing: WriteItem[]; speaking: SpeakItem[] };

export const SECTIONS = ["core", "reading", "listening", "writing", "speaking"] as const;
export type Section = (typeof SECTIONS)[number];

export type Ans = { v: string | number | null; ok: boolean | null; ms?: number; dk?: boolean }; // dk — «Не знаю»
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
  core: { id: string; step: number }[]; // путь по ядру в порядке выдачи
  answers: Record<string, Ans>; // по id задания ядра и id вопроса чтения/аудирования
  reading: string[]; listening: string[];
  rdone: string[]; ldone: string[]; // тексты и записи, на которые ученик уже ответил
  plays: Record<string, number>;
  writing?: { id: string; text: string };
  speaking?: { id: string; rec: Record<string, string> }; // номер вопроса → ключ записи
  level?: PLevel; step?: number; // результат ядра — от него зависят остальные разделы
};

/** expected: ожидаемый уровень от учителя (A1 / B1 / B2) — тогда без разминки, старт с него. */
export const EXPECT = { A1: 0, B1: 4, B2: 6 } as const;
export type Expect = keyof typeof EXPECT;
export const emptyState = (expected?: Expect | null): PState => ({
  v: 1, section: "intro", items: {}, core: [], answers: {}, reading: [], listening: [], rdone: [], ldone: [], plays: {},
  ...(expected && expected in EXPECT ? { start: EXPECT[expected] } : { warm: WARM.length }),
});
/** Разминка: A1, A2, A2 — первые задания лёгкие, дальше лесенка с B1. */
const WARM = [0, 2, 2];

const BASE: Record<PLevel, number> = { A1: 0, A2: 2, B1: 4, B2: 6, C1: 8 };
/** band 1 уровня X → X, band 2 и 3 → X+ (у C1 — всегда C1). */
export const stepOf = (level: PLevel, band: number) => Math.min(8, BASE[level] + (band > 1 ? 1 : 0));
export const levelOfStep = (s: number): PLevel => PL_LEVELS[Math.floor(Math.max(0, Math.min(8, s)) / 2)];
export const subOf = (s: number): Sub => STEPS[Math.max(0, Math.min(8, Math.round(s)))];
export const stepIdx = (sub: string) => STEPS.indexOf(sub as Sub);

const CORE_MAX = 36;

// ───────── Ядро: лесенка ─────────

type Stat = { n: number; c: number };
export function stepStats(st: PState) {
  const m = new Map<number, Stat>();
  for (const x of st.core) {
    const a = st.answers[x.id];
    const s = m.get(x.step) ?? { n: 0, c: 0 };
    s.n += 1; if (a?.ok) s.c += 1;
    m.set(x.step, s);
  }
  return m;
}
/** Ступень пройдена: 2 из 3 по ходу, 4 из 5 на границе. undefined — ещё не ясно. */
function verdict(s: Stat | undefined, exhausted: boolean): boolean | undefined {
  if (!s || s.n === 0) return undefined;
  if (s.n >= 5) return s.c >= 4;
  if (s.n === 3) return s.c >= 2;
  if (exhausted) return s.c / s.n >= 2 / 3; // в банке кончились задания этой ступени
  return undefined;
}

function boundary(st: PState, bank: Bank) {
  const stats = stepStats(st);
  const used = new Set(st.core.map((x) => x.id));
  const left = (s: number) => bank.core.filter((x) => stepOf(x.level, x.band) === s && !used.has(x.id)).length;
  const v = (s: number) => verdict(stats.get(s), left(s) === 0);
  let P = -1;
  for (let s = 8; s >= 0; s--) if (v(s) === true && v(s - 1) !== false) { P = s; break; }
  let F = 9;
  for (let s = P + 1; s <= 8; s++) if (v(s) === false) { F = s; break; }
  return { stats, left, v, P, F };
}

/** Какую ступень спрашивать дальше; null — ядро закончено. */
export function nextStep(st: PState, bank: Bank): number | null {
  if (st.core.length >= CORE_MAX) return null;
  const warm = st.warm ?? 0;
  if (st.core.length < warm) return WARM[st.core.length];
  const { stats, left, v, P, F } = boundary(st, bank);
  const s0 = st.start ?? (st.beginner ? 0 : 4);
  // начатый блок (меньше 3) или добор на границе (4 из 5) — продолжаем ту же ступень (разминку не продолжаем)
  if (st.core.length > warm) {
    const x = st.core[st.core.length - 1], s = stats.get(x.step)!;
    if ((s.n < 3 || s.n === 4) && left(x.step) > 0 && v(x.step) === undefined) return x.step;
  }
  if (st.core.length === warm) return s0;
  // сначала шаги через целый уровень, потом по одной ступени
  if (P === -1 && F === 9) return s0;
  if (F === 9 && P < 8) { const t = Math.min(8, P + 2); return v(t) === undefined && left(t) ? t : v(P + 1) === undefined && left(P + 1) ? P + 1 : confirm(); }
  if (P === -1 && F > 0) { const t = Math.max(0, F - 2); return v(t) === undefined && left(t) ? t : v(F - 1) === undefined && left(F - 1) ? F - 1 : confirm(); }
  if (F - P > 1) { for (let s = P + 1; s < F; s++) if (v(s) === undefined && left(s)) return s; }
  return confirm();

  // граница найдена: по 5 заданий на последнюю пройденную и первую непройденную ступень
  function confirm(): number | null {
    for (const s of [P, F]) {
      if (s < 0 || s > 8) continue;
      const n = stats.get(s)?.n ?? 0;
      if (n < 5 && left(s) > 0) return s;
    }
    // ступень под результатом тоже проверяем: так одна удачная догадка не поднимает итог
    if (P > 0 && v(P - 1) === undefined && left(P - 1) > 0) return P - 1;
    return null;
  }
}

/** Случайное задание ступени: без повторов, грамматика и лексика по очереди, по возможности новая тема. */
export function pickCore(st: PState, bank: Bank, step: number, rnd: () => number = Math.random): CoreItem | null {
  const used = new Set(st.core.map((x) => x.id));
  const topics = new Set(st.core.map((x) => (st.items[x.id] as CoreItem | undefined)?.topic_id));
  const last = st.core.length ? (st.items[st.core[st.core.length - 1].id] as CoreItem | undefined)?.skill : undefined;
  let pool = bank.core.filter((x) => stepOf(x.level, x.band) === step && !used.has(x.id));
  if (!pool.length) return null;
  const fresh = pool.filter((x) => !topics.has(x.topic_id));
  if (fresh.length) pool = fresh;
  const other = pool.filter((x) => x.skill !== last);
  if (other.length) pool = other;
  return pool[Math.floor(rnd() * pool.length)];
}

/** Примерная доля пройденного ядра (без цифр — точное число заданий заранее неизвестно). */
export function coreProgress(st: PState, bank: Bank) {
  const done = st.core.filter((x) => st.answers[x.id]).length;
  const { stats, P, F } = boundary(st, bank);
  let rem = Math.max(0, (st.warm ?? 0) - st.core.length);
  const last = st.core[st.core.length - 1];
  const ln = last ? stats.get(last.step)?.n ?? 0 : 0;
  if (ln > 0 && ln < 3) rem += 3 - ln;
  const found = P >= 0 && F === P + 1 || P === 8 || (P === -1 && F === 0);
  if (!found) rem += 3 + 10;
  else { for (const x of [P, F]) if (x >= 0 && x <= 8) rem += Math.max(0, 5 - (stats.get(x)?.n ?? 0)); if (P > 0 && !stats.get(P - 1)) rem += 3; }
  const p = done / Math.max(1, done + rem);
  st.pmax = Math.max(st.pmax ?? 0, Math.min(0.95, p));
  return st.pmax;
}

export function coreResult(st: PState, bank: Bank) {
  const { P } = boundary(st, bank);
  return Math.max(0, P);
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
export function fallbackText<T extends ReadItem | ListenItem>(list: T[], st: PState, kind: "reading" | "listening", rnd: () => number = Math.random): T | null {
  const ids = kind === "reading" ? st.reading : st.listening;
  const level = st.level!;
  const li = PL_LEVELS.indexOf(level);
  if (li === 0) return null;
  const lower = PL_LEVELS[li - 1];
  if (ids.some((id) => st.items[id]?.level === lower)) return null; // уже дали
  const qs = ids.flatMap((id) => (st.items[id] as T).questions);
  const ok = qs.filter((q) => st.answers[q.id]?.ok).length;
  if (!qs.length || ok / qs.length >= 0.5) return null;
  return pickBands(list.filter((x) => x.level === lower), false, 1, rnd)[0] ?? null;
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

export type Summary = {
  coreStep: number; level: PLevel;
  path: { step: number; n: number; c: number; pass: boolean | undefined }[];
  core: Record<string, { grammar: [number, number]; vocabulary: [number, number] }>; // уровень → [верно, всего]
  reading: Record<string, [number, number]>; listening: Record<string, [number, number]>;
  readStep: number | null; listenStep: number | null;
};
export function summarize(st: PState, bank: Bank): Summary {
  const coreStep = st.step ?? coreResult(st, bank);
  const stats = stepStats(st);
  const path: Summary["path"] = [];
  for (const x of st.core) {
    if (path.some((p) => p.step === x.step)) continue;
    const s = stats.get(x.step)!;
    path.push({ step: x.step, n: s.n, c: s.c, pass: verdict(s, true) });
  }
  const core: Summary["core"] = {};
  for (const x of st.core) {
    const it = st.items[x.id] as CoreItem; if (!it) continue;
    const row = (core[it.level] ??= { grammar: [0, 0], vocabulary: [0, 0] });
    row[it.skill][1] += 1; if (st.answers[x.id]?.ok) row[it.skill][0] += 1;
  }
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
  return { coreStep, level: levelOfStep(coreStep), path, core, reading, listening, readStep: skillStep(reading, st.level), listenStep: skillStep(listening, st.level) };
}

/** Ступень по чтению/аудированию: ≥ 80% на уровне ядра → X+, ≥ 50% → X, иначе — по запасному тексту ниже. */
function skillStep(r: Record<string, [number, number]>, level?: PLevel) {
  if (!level || !r[level]?.[1]) return null;
  const pct = r[level][0] / r[level][1];
  const b = BASE[level];
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

/** Подсказка итога: медиана ступеней по навыкам (вниз). Итог всё равно выбирает учитель. */
export function finalHint(parts: (number | null | undefined)[]) {
  const xs = parts.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.floor((xs.length - 1) / 2)];
}

export const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
