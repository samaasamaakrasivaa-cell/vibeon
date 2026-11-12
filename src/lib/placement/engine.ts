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

export type Ph = "w" | "l" | "d" | "s" | "x" | "r" | "f" | "vw" | "vm" | "vu" | "vd" | "vl" | "vc";
export type Ans = { v: string | number | null; ok: boolean | null; ms?: number; dk?: boolean; h?: boolean; tr?: (string | number)[] }; // dk — «Не знаю», h — открыл подсказку, tr — что выбирал до итогового ответа
export type PState = {
  track?: "adult" | "teen"; // версия теста: взрослая или Placement test Teens
  v: 1;
  section: "intro" | Section | "done";
  beginner?: boolean; // старые прохождения
  start?: number; // ступень старта по ожидаемому уровню (учитель отметил при назначении)
  warm?: number; // сколько заданий разминки (A1–A2) в начале, если уровень не отмечен
  pmax?: number; // полоска прогресса ядра не идёт назад
  open?: Record<string, number>; // черновики ответов к текстам и записям — до «Завершить раздел»
  openTr?: Record<string, number[]>; // прежние варианты в этих черновиках (учителю видно, что ученик менял ответ)
  peek?: string[]; // номера вопросов говорения, текст которых ученик открыл
  times?: Record<string, number>; // время по разделам, мс
  rerec?: Record<string, number>; // сколько раз перезаписан ответ на вопрос говорения
  items: Record<string, AnyItem>; // снимок выданных заданий (с ответами)
  core: { id: string; step: number; ph?: Ph }[]; // путь: грамматика (разминка, поиск, проверка, срез выше), затем лексика (vw, vl, vc)
  diag?: number; // уровень подробной проверки (0 = A1 … 4 = C1)
  fb?: boolean; // уже переходили на уровень ниже (погорячились)
  up?: boolean; // уже переходили на уровень выше (срез выше сдан уверенно)
  closed?: string[]; // завершённые разделы после ядра (между открытыми можно переключаться)
  seen?: string[]; // задания, которые ученик видел в прошлых прохождениях — при перепрохождении берём другие
  answers: Record<string, Ans>; // по id задания ядра и id вопроса чтения/аудирования
  reading: string[]; listening: string[];
  rdone: string[]; ldone: string[]; // тексты и записи, на которые ученик уже ответил
  plays: Record<string, number>;
  writing?: { id: string; text: string };
  speaking?: { id: string; rec: Record<string, string> }; // номер вопроса → ключ записи
  // дополнительное задание письма/говорения уровнем выше или ниже (даёт учитель): прошлые задания с ответами и оценками
  wsPrev?: { kind: "writing" | "speaking"; id: string; text?: string; rec?: Record<string, string>; rerec?: Record<string, number>; peek?: string[]; marks?: Record<string, number>; points?: boolean[] }[];
  wsExtra?: { writing?: number; speaking?: number }; // направление: 1 — выше, -1 — ниже (одно на навык)
  level?: PLevel; step?: number; // level — уровень текстов (меньший из грамматики и лексики), step — итог грамматики
  vstep?: number; // итог лексики
};

/** expected: ожидаемый уровень от учителя (A1 / B1 / B2) — тогда без разминки, поиск начинается с него. */
export const EXPECT = { A1: 0, B1: 2, B2: 3 } as const; // индекс уровня в PL_LEVELS
export type Expect = keyof typeof EXPECT;
/** Teens: «начинающий» — A1, «средний» — A2–B1 (старт с A2), «продвинутый» — B2. */
const EXPECT_TEEN: Record<Expect, number> = { A1: 0, B1: 1, B2: 3 };
export const emptyState = (expected?: Expect | null, track: "adult" | "teen" = "adult"): PState => ({
  v: 1, section: "intro", items: {}, core: [], answers: {}, reading: [], listening: [], rdone: [], ldone: [], plays: {},
  ...(track === "teen" ? { track } : {}),
  // Teens: разминка всегда (мягкий вход с базы A1), поиск по умолчанию — с A2
  ...(track === "teen"
    ? { warm: WARM_TEEN.length, start: expected && expected in EXPECT ? EXPECT_TEEN[expected] : 1 }
    : expected && expected in EXPECT ? { start: EXPECT[expected] } : { warm: WARM.length }),
});
/** Разминка: одно задание A1 и два A2 из опорных групп — они же идут в зачёт этих групп. */
const WARM = [0, 1, 1];
/** Teens: четыре простых задания A1 по базе (to be, Present Simple с вопросами, Present Continuous, can / have got), потом два A2. */
const WARM_TEEN = [0, 0, 0, 0, 1, 1];
const warmOf = (st: PState) => (st.track === "teen" ? WARM_TEEN : WARM);

export const BASE: Record<PLevel, number> = { A1: 0, A2: 2, B1: 4, B2: 6, C1: 8 };
/** band 1 уровня X → X, band 2 и 3 → X+ (у C1 — всегда C1). */
export const stepOf = (level: PLevel, band: number) => Math.min(8, BASE[level] + (band > 1 ? 1 : 0));
export const levelOfStep = (s: number): PLevel => PL_LEVELS[Math.floor(Math.max(0, Math.min(8, s)) / 2)];
export const subOf = (s: number): Sub => STEPS[Math.max(0, Math.min(8, Math.round(s)))];
export const stepIdx = (sub: string) => STEPS.indexOf(sub as Sub);

const CORE_MAX = 60;
const CORE_MAX_TEEN = 40; // Teens короче: весь тест ~25–40 минут
const PER_GROUP = 3; // заданий из каждой группы на подробной проверке
const FALLBACK_AFTER = 9, FALLBACK_BELOW = 0.4; // после 9 заданий меньше 40% — уровень ниже
const SLICE_FROM = 0.8, SLICE_GROUPS = 4, SLICE_PER = 2, UP_FROM = 0.7, EDGE_FROM = 0.55, EXTRA = 4, REPEATS = 6, REPEAT_GAP = 3, COVER_MAX = 16, COVER_PER = 3, COVER_MIN = 3, FAM_ENOUGH = 7;
// уровень сделан на 80%+ — срез уровня выше (8 заданий); срез 70%+ — уровень выше целиком; 55–70% — ещё 4 задания уровня выше и решение по сумме

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

/** Группа и тема последнего задания — чтобы следующее не было на ту же тему. */
const lastOf = (st: PState) => { const x = st.core[st.core.length - 1]; const it = x ? (st.items[x.id] as CoreItem | undefined) : undefined; return { group: it?.group, topic: it?.topic_id }; };
/** Порядок групп: группа последнего задания — в конец, чтобы две одинаковые темы не шли подряд. */
const notLast = <T extends { id: string }>(st: PState, gs: T[]) => { const g = lastOf(st).group; return [...gs.filter((x) => x.id !== g), ...gs.filter((x) => x.id === g)]; };

/** pref: easy — простые задания уровня (band 1, сам уровень X), hard — сложные (band 2–3, X+). */
function pickFrom(st: PState, bank: Bank, gid: string, rnd: () => number, pref?: "easy" | "hard", topicRe?: RegExp): CoreItem | null {
  const used = new Set(st.core.map((x) => x.id));
  const topics = new Set(st.core.map((x) => (st.items[x.id] as CoreItem | undefined)?.topic_id));
  let pool = bank.core.filter((x) => x.group === gid && !used.has(x.id));
  if (!pool.length) return null;
  const unseen = st.seen?.length ? pool.filter((x) => !st.seen!.includes(x.id)) : [];
  if (unseen.length) pool = unseen;
  const want = pref === "easy" ? pool.filter((x) => x.band === 1) : pref === "hard" ? pool.filter((x) => x.band > 1) : [];
  if (want.length) pool = want;
  const fresh = pool.filter((x) => !topics.has(x.topic_id)); // по возможности — другая тема внутри группы
  if (fresh.length) pool = fresh;
  else { const last = lastOf(st).topic; const other = pool.filter((x) => x.topic_id !== last); if (other.length) pool = other; } // не та же тема, что только что
  if (topicRe) { const t = pool.filter((x) => topicRe.test(x.topic_id)); if (t.length) pool = t; }
  return pool[Math.floor(rnd() * pool.length)];
}

const levelAcc = (st: PState, li: number) => stat(st, (it, x) => it.level === PL_LEVELS[li] && it.skill === "grammar" && !x.ph?.startsWith("v"));

/** Следующее задание ядра; null — ядро закончено. Отмечает в st этап проверки (diag, fb). */
export function nextCore(st: PState, bank: Bank, rnd: () => number = Math.random): { item: CoreItem; ph: Ph } | null {
  const cap = st.track === "teen" ? CORE_MAX_TEEN : CORE_MAX;
  // лимит длины — для основной проверки; добор по разделам с малым числом ответов идёт и после него (не больше COVER_MAX)
  if (st.core.length >= cap) return st.diag !== undefined && st.core.length < cap + COVER_MAX ? cover(st, bank, st.diag, rnd) : null;
  const warm = st.warm ?? 0;
  if (st.core.length < warm) {
    // два задания разминки одного уровня подряд — второе из другой группы, чтобы тема не повторялась
    const W = warmOf(st), i = st.core.length, lv = W[i];
    const others = groupsOf(bank, lv).filter((g) => !g.anchor);
    const k = W.slice(0, i).filter((x) => x === lv).length; // какое по счёту задание этого уровня в разминке
    const gid = k === 0 || !others.length ? anchorOf(bank, lv).id
      : st.track === "teen" && lv === 0 ? groupsOf(bank, lv)[Math.min(k, groupsOf(bank, lv).length - 1)].id // Teens A1: группы по порядку — база
      : others[Math.floor(rnd() * others.length)].id;
    const it = pickFrom(st, bank, gid, rnd, "easy");
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
  // провал на подробной проверке — спускаемся на уровень; если и там провал — ещё ниже (угаданные опорные задания не должны «застрять» наверху)
  if (!st.up && D > 0 && dAcc.n >= FALLBACK_AFTER && dAcc.c / dAcc.n < FALLBACK_BELOW) { st.fb = true; st.diag = D - 1; return nextCore(st, bank, rnd); }
  void dItems;
  const gs = notLast(st, groupsOf(bank, D));
  // большой раздел уже проверен вдоль и поперёк (7+ ответов, почти всё верно) — третье, сложное задание группы не добавляем
  const famOf = new Map((bank.families ?? []).flatMap((f) => f.topics.map((t) => [t, f] as const)));
  const famFull = (g: Group) => {
    const f = famOf.get(g.topics[0]); if (!f) return false;
    const s2 = stat(st, (it, x) => it.skill === "grammar" && !x.ph?.startsWith("v") && f.topics.includes(it.topic_id));
    return s2.n >= FAM_ENOUGH && s2.n - s2.c <= 1;
  };
  // по кругу: сначала из каждой группы простое задание, потом два сложных
  for (let round = 1; round <= PER_GROUP; round++) {
    for (const g of gs) {
      if (inGroup(st, g.id) >= round) continue;
      if (round === PER_GROUP && famFull(g)) continue;
      const it = pickFrom(st, bank, g.id, rnd, round === 1 ? "easy" : "hard");
      if (it) return { item: it, ph: "d" };
    }
  }
  // уровень сделан уверенно — короткий срез уровня выше; 70%+ — проверяем уровень выше целиком; 55–70% — уточняем ещё 4 заданиями
  if (D < 4 && !st.fb && !st.up) {
    const sl = stat(st, (it, x) => (x.ph === "s" || x.ph === "x") && it.level === PL_LEVELS[D + 1]);
    const xs = st.core.filter((x) => x.ph === "x").length;
    if (sl.n >= SLICE_GROUPS * SLICE_PER) {
      const p = sl.c / sl.n;
      if (p >= UP_FROM && (xs === 0 || xs >= EXTRA)) { st.up = true; st.diag = D + 1; return nextCore(st, bank, rnd); }
      if (xs < EXTRA && (xs > 0 || p >= EDGE_FROM)) {
        const gs = notLast(st, [...groupsOf(bank, D + 1)].sort((a, b) => inGroup(st, a.id) - inGroup(st, b.id))); // сначала группы, где заданий меньше; не та же, что только что
        for (const g of gs) {
          const it = pickFrom(st, bank, g.id, rnd);
          if (it) return { item: it, ph: "x" };
        }
      }
    } else {
      const acc = levelAcc(st, D);
      if (acc.n && acc.c / acc.n >= SLICE_FROM) {
        const up = notLast(st, groupsOf(bank, D + 1).slice(0, SLICE_GROUPS));
        for (let round = 1; round <= SLICE_PER; round++)
          for (const g of up) {
            if (inGroup(st, g.id) >= round) continue;
            const it = pickFrom(st, bank, g.id, rnd, "easy");
            if (it) return { item: it, ph: "s" };
          }
      }
    }
  }
  // повтор после ошибки: на тему, где ученик ошибся, — ещё одно задание (проверить, случайность или пробел)
  const reps = st.core.filter((x) => x.ph === "r").length;
  if (reps < REPEATS) {
    const done = new Set(st.core.filter((x) => x.ph === "r").map((x) => (st.items[x.id] as CoreItem).topic_id));
    const lastTopic = lastOf(st).topic;
    // сначала ошибки на другие темы, ошибка на тему последнего задания — в конец (повтор не должен идти сразу следом)
    const cands = st.core.map((x, i) => ({ x, i })).filter(({ x, i }) => x.ph === "d" && i < st.core.length - REPEAT_GAP);
    const order = [...cands.filter(({ x }) => (st.items[x.id] as CoreItem)?.topic_id !== lastTopic), ...cands.filter(({ x }) => (st.items[x.id] as CoreItem)?.topic_id === lastTopic)];
    for (const { x } of order) {
      const it = st.items[x.id] as CoreItem;
      if (!it || it.level !== PL_LEVELS[D] || st.answers[x.id]?.ok || done.has(it.topic_id)) continue;
      const used = new Set(st.core.map((y) => y.id));
      const pool = bank.core.filter((y) => y.topic_id === it.topic_id && !used.has(y.id) && y.skill === "grammar");
      const unseen = st.seen?.length ? pool.filter((y) => !st.seen!.includes(y.id)) : [];
      const pick = (unseen.length ? unseen : pool)[Math.floor(rnd() * (unseen.length || pool.length))];
      if (pick) return { item: pick, ph: "r" };
      done.add(it.topic_id);
    }
  }
  return cover(st, bank, D, rnd);
}

/** Добор в конце грамматики: в каждом большом разделе (времена, условные, глагольные модели…) должно быть хотя бы 3 ответа
 *  на уровне проверки (или уровнем ниже, если на этом уровне у раздела нет тем); 1 из 2 — спорно, даём ещё одно. */
function cover(st: PState, bank: Bank, D: number, rnd: () => number): { item: CoreItem; ph: Ph } | null {
  const fams = bank.families ?? [];
  const done = st.core.filter((x) => x.ph === "f");
  if (!fams.length || done.length >= COVER_MAX) return null;
  const topicLv = new Map(bank.core.filter((x) => x.skill === "grammar").map((x) => [x.topic_id, PL_LEVELS.indexOf(x.level)] as const));
  const used = new Set(st.core.map((x) => x.id));
  const asked = (t: string) => st.core.filter((x) => (st.items[x.id] as CoreItem)?.topic_id === t).length;
  const famOf = new Map(fams.flatMap((f) => f.topics.map((t) => [t, f.id] as const)));
  const lastFam = famOf.get(lastOf(st).topic ?? "");
  const cands: { f: Family; need: number; topics: string[] }[] = [];
  for (const f of fams) {
    const at = (li: number) => f.topics.filter((t) => topicLv.get(t) === li);
    const L = at(D).length ? D : D > 0 && at(D - 1).length ? D - 1 : -1;
    if (L < 0) continue;
    // считаем ровно то, что потом покажет таблица разделов: если у раздела есть темы на уровне проверки — ответы на этом уровне, иначе — все
    const s2 = stat(st, (it, x) => it.skill === "grammar" && !x.ph?.startsWith("v") && f.topics.includes(it.topic_id) && (L === D ? PL_LEVELS.indexOf(it.level) === D : true));
    const extra = done.filter((x) => f.topics.includes((st.items[x.id] as CoreItem)?.topic_id)).length;
    const need = s2.n < COVER_MIN ? COVER_MIN - s2.n : s2.n === COVER_MIN && s2.c === COVER_MIN - 2 ? 1 : 0; // 1 из 3 — спорно, ещё одно
    if (need > 0 && extra < COVER_PER) cands.push({ f, need, topics: at(L) });
  }
  cands.sort((a, b) => b.need - a.need || Number(a.f.id === lastFam) - Number(b.f.id === lastFam));
  for (const c of cands) {
    let pool = bank.core.filter((x) => x.skill === "grammar" && c.topics.includes(x.topic_id) && !used.has(x.id));
    const unseen = st.seen?.length ? pool.filter((x) => !st.seen!.includes(x.id)) : [];
    if (unseen.length) pool = unseen;
    if (!pool.length) continue;
    const least = Math.min(...pool.map((x) => asked(x.topic_id)));
    pool = pool.filter((x) => asked(x.topic_id) === least); // сначала темы раздела, по которым вопросов ещё не было
    const other = pool.filter((x) => x.topic_id !== lastOf(st).topic); if (other.length) pool = other;
    return { item: pool[Math.floor(rnd() * pool.length)], ph: "f" };
  }
  return null;
}

/** Повторная проверка после ошибки: тема, первый ответ, повторный. */
export function repeats(st: PState) {
  return st.core.filter((x) => x.ph === "r" && st.answers[x.id]).map((x) => {
    const it = st.items[x.id] as CoreItem;
    const first = st.core.find((y) => y.ph === "d" && (st.items[y.id] as CoreItem)?.topic_id === it.topic_id);
    return { topic: it.topic_ru, again: !!st.answers[x.id]?.ok, firstId: first?.id ?? null };
  });
}

// ───────── Лексика: проверка уровня грамматики ─────────
// Разминка 2 задания уровнем ниже (в зачёт не идёт) → основной уровень = уровень грамматики, по 2 задания каждого вида →
// 70%+ — по одному заданию каждого вида уровнем выше; меньше 40% — 6 заданий уровнем ниже.

const VKINDS = ["v1", "v2", "v3", "v4", "v5"] as const;
// id вида: «a1-v2» во взрослом банке, «t-a1-v2» — в Teens
const vGroup = (bank: Bank, li: number, k: string) => bank.groups.find((g) => g.kind === "vocabulary" && g.level === PL_LEVELS[li] && g.id.endsWith(`-${k}`));
const vKinds = (bank: Bank, li: number) => VKINDS.filter((k) => vGroup(bank, li, k));
const vStat = (st: PState, li: number, phs: Ph[]) => stat(st, (it, x) => it.level === PL_LEVELS[li] && !!x.ph && phs.includes(x.ph) && it.skill === "vocabulary");
const gLevel = (st: PState) => Math.floor(Math.max(0, Math.min(8, st.step ?? 0)) / 2);
const kindCount = (st: PState, li: number, ph: Ph, k: string) =>
  st.core.filter((x) => x.ph === ph && (st.items[x.id] as CoreItem)?.level === PL_LEVELS[li] && (st.items[x.id] as CoreItem)?.group?.endsWith(`-${k}`)).length;

function vPick(st: PState, bank: Bank, li: number, ph: Ph, per: number, rnd: () => number, total = Infinity): { item: CoreItem; ph: Ph } | null {
  const ks = vKinds(bank, li);
  if (st.core.filter((x) => x.ph === ph).length >= total) return null;
  for (let round = 1; round <= per; round++)
    for (const k of ks) {
      if (kindCount(st, li, ph, k) >= round) continue;
      const it = pickFrom(st, bank, vGroup(bank, li, k)!.id, rnd, round === 1 ? "easy" : "hard");
      if (it) return { item: it, ph };
    }
  return null;
}

export function nextVocab(st: PState, bank: Bank, rnd: () => number = Math.random): { item: CoreItem; ph: Ph } | null {
  const G = gLevel(st);
  // разминка уровнем ниже: предлоги / сочетаемость и словообразование — там чаще всего «дыры» в базе
  // разминка уровнем ниже — по одному заданию каждого вида, начиная с предлогов и словообразования: видно, крепкая ли база
  if (G > 0) {
    const order = (["v2", "v3", "v1", "v4", "v5"] as const).filter((k) => vGroup(bank, G - 1, k));
    const n = st.core.filter((x) => x.ph === "vw").length;
    if (n < order.length) {
      const g = vGroup(bank, G - 1, order[n])!;
      const it = (order[n] === "v2" ? pickFrom(st, bank, g.id, rnd, "easy", /preposition/) : null) ?? pickFrom(st, bank, g.id, rnd, "easy");
      if (it) return { item: it, ph: "vw" };
    }
  }
  const main = vPick(st, bank, G, "vm", 2, rnd);
  if (main) return main;
  const m = vStat(st, G, ["vm"]), pm = m.n ? m.c / m.n : 0;
  if (pm >= 0.7 && G < 4) return vPick(st, bank, G + 1, "vu", 1, rnd);
  if (pm < 0.4 && G > 0) return vPick(st, bank, G - 1, "vd", 2, rnd, 6);
  return null;
}

/** Итог лексики (относительно уровня грамматики X). */
export function vocabResult(st: PState) {
  const G = gLevel(st), b = BASE[PL_LEVELS[G]];
  const m = vStat(st, G, ["vm"]), pm = m.n ? m.c / m.n : 0;
  const u = G < 4 ? vStat(st, G + 1, ["vu"]) : { n: 0, c: 0 }, pu = u.n ? u.c / u.n : 0;
  if (G === 4) return pm >= 0.6 ? 8 : pm >= 0.4 ? 7 : vDown();
  // в основном блоке половина заданий — сложные (уровень X+), поэтому 80%+ на нём — уже X+
  if (pm >= 0.85) return pu >= 0.75 ? BASE[PL_LEVELS[G + 1]] : b + 1;
  if (pm >= 0.7) return pu >= 0.5 ? b + 1 : b;
  if (pm >= 0.6) return b;
  if (pm >= 0.4) return Math.max(0, b - 1);
  return vDown();
  function vDown() {
    if (G === 0) return 0;
    const d = vStat(st, G - 1, ["vd", "vw"]), pd = d.n ? d.c / d.n : 0, bd = BASE[PL_LEVELS[G - 1]]; // разминка тоже про уровень ниже — учитываем
    return pd >= 0.8 ? bd + 1 : pd >= 0.6 ? bd : Math.max(0, bd - 1);
  }
}
export function vocabProgress(st: PState, bank?: Bank) {
  const done = st.core.filter((x) => x.ph?.startsWith("v") && st.answers[x.id]).length;
  const G = gLevel(st);
  const mainTotal = bank ? vKinds(bank, G).length * 2 : 10;
  const rem = Math.max(0, (G > 0 ? (bank ? vKinds(bank, G - 1).length : 4) : 0) + mainTotal - done) + 4;
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
/** Чтение и аудирование — тексты по одному, следующий по результату предыдущего (максимум 3):
 * 1-й: 85%+ → уровнем выше; меньше 50% → уровнем ниже; 50–85% → ещё один того же уровня.
 * 2-й (был выше): меньше 50% → хватит; 80%+ → ещё уровнем выше; 50–60% — спорно → ещё один того же уровня.
 * 2-й (был ниже): меньше 50% → ещё уровнем ниже. 2-й того же уровня — хватит. */
export function nextText<T extends ReadItem | ListenItem>(list: T[], st: PState, kind: "reading" | "listening", rnd: () => number = Math.random): T | null {
  const ids = kind === "reading" ? st.reading : st.listening;
  if (!ids.length || ids.length >= 3) return null;
  const pct = (id: string) => { const qs = (st.items[id] as T).questions; return qs.filter((q) => st.answers[q.id]?.ok).length / Math.max(1, qs.length); };
  const li = (id: string) => PL_LEVELS.indexOf(st.items[id].level);
  const used = new Set(ids);
  const at = (l: number) => (l < 0 || l > 4 ? null : pickBands(list.filter((x) => x.level === PL_LEVELS[l] && !used.has(x.id)), (st.step ?? 0) % 2 === 1, 1, rnd)[0] ?? null);
  const L1 = li(ids[0]), p1 = pct(ids[0]);
  if (ids.length === 1) return p1 >= 0.85 ? at(L1 + 1) : p1 < 0.5 ? at(L1 - 1) : at(L1);
  const L2 = li(ids[1]), p2 = pct(ids[1]);
  if (L2 > L1) return p2 < 0.5 ? null : p2 >= 0.8 ? at(L2 + 1) : p2 <= 0.6 ? at(L2) : null; // 50–60% — пограничный: ещё один того же уровня
  if (L2 < L1) return p2 < 0.5 ? at(L2 - 1) : null;
  return null;
}
/** Первый текст — уровня, с которого начинается чтение. */
export function firstText<T extends ReadItem | ListenItem>(list: T[], level: PLevel, plus: boolean, rnd: () => number = Math.random) {
  const pool = list.filter((x) => x.level === level);
  const most = Math.max(0, ...pool.map((x) => x.questions.length));
  return pickBands(pool.filter((x) => x.questions.length === most), plus, 1, rnd)[0] ?? pickBands(pool, plus, 1, rnd)[0] ?? null;
}
/** С какого уровня начинать тексты: по грамматике; если лексика расходится больше чем на уровень — середина с перевесом к грамматике. */
export function textLevel(gStep: number, vStep?: number) {
  const g = Math.floor(gStep / 2), v = vStep === undefined ? g : Math.floor(vStep / 2);
  if (Math.abs(g - v) <= 1) return g;
  return g > v ? Math.ceil((g + v) / 2) : Math.floor((g + v) / 2);
}
export function pickTask<T extends WriteItem | SpeakItem>(list: T[], level: PLevel, plus: boolean, rnd: () => number = Math.random, avoid: string[] = []): T | null {
  const fresh = list.filter((x) => !avoid.includes(x.id));
  const src = fresh.some((x) => x.level === level) ? fresh : list;
  const c = src.filter((x) => x.level === level && (plus ? x.band > 1 : x.band === 1));
  const pool = c.length ? c : src.filter((x) => x.level === level);
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
  families: { id: string; name: string; what: string; lvl: [number, number]; all: [number, number]; by: Record<string, [number, number]>; has?: string[] }[]; // грамматика по большим разделам: по уровням, на уровне проверки и всего
  vlevels: { level: PLevel; warm: boolean; kinds: { id: string; name: string; c: number; n: number }[] }[]; // лексика: виды заданий на каждом уровне
  vweak: string[]; // темы лексики, где были ошибки
  repeats: { topic: string; again: boolean; firstId: string | null }[]; // повторная проверка после ошибки
  forms: { choice: [number, number]; typed: [number, number] }; // грамматика: выбор из вариантов (узнаёт) и вписать самому (употребляет)
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
  const vf = st.vstep !== undefined ? gLevel(st) : null;
  const vgroups: GroupRes[] = vf === null ? [] : vKinds(bank, vf).map((k) => {
    const g = vGroup(bank, vf, k)!;
    const r = { id: g.id, name: g.name_ru, what: g.what_ru, kind: "vocabulary" as const, level: g.level, c: 0, n: 0, dk: 0 };
    for (const x of st.core) { const it = st.items[x.id] as CoreItem; const a = st.answers[x.id]; if (!it || !a || it.group !== g.id || !x.ph?.startsWith("v")) continue; r.n++; if (a.ok) r.c++; if (a.dk) r.dk++; }
    return r;
  });
  const vprobes = PL_LEVELS.map((l, li) => { const s2 = vStat(st, li, ["vm", "vu", "vd"]); return { level: l, ...s2, pass: s2.n >= 3 ? s2.c / s2.n >= 0.6 : undefined }; }).filter((x) => x.n > 0);
  const reading = byLevelOf(st, st.rdone), listening = byLevelOf(st, st.ldone);
  const order = new Map(bank.groups.map((g, i) => [g.id, i]));
  const famOf = new Map((bank.families ?? []).flatMap((f) => f.topics.map((t) => [t, f.id] as const)));
  const topicLevel = new Map(bank.core.filter((x) => x.skill === "grammar").map((x) => [x.topic_id, x.level] as const));
  // has — уровни, на которых у раздела вообще есть темы (иначе в таблице «не входит в уровень», а не «мало данных»)
  const fam = new Map((bank.families ?? []).map((f) => [f.id, { id: f.id, name: f.name_ru, what: f.what_ru, lvl: [0, 0] as [number, number], all: [0, 0] as [number, number], by: {} as Record<string, [number, number]>, has: [...new Set(f.topics.map((t) => topicLevel.get(t)).filter(Boolean) as string[])] }]));
  const DL = st.diag !== undefined ? PL_LEVELS[st.diag] : null;
  for (const x of st.core) {
    const it = st.items[x.id] as CoreItem; const a = st.answers[x.id];
    if (!it || !a || it.skill !== "grammar" || x.ph?.startsWith("v")) continue;
    const f = fam.get(famOf.get(it.topic_id) ?? ""); if (!f) continue;
    f.all[1]++; if (a.ok) f.all[0]++;
    const b = (f.by[it.level] ??= [0, 0]); b[1]++; if (a.ok) b[0]++;
    if (it.level === DL) { f.lvl[1]++; if (a.ok) f.lvl[0]++; }
  }
  // лексика по уровням и видам: уровень ниже (разминка), уровень грамматики, уровень выше
  const vlevels: Summary["vlevels"] = [];
  const vweak = new Set<string>();
  for (const li of [0, 1, 2, 3, 4]) {
    const kinds = vKinds(bank, li).map((k) => {
      const g = vGroup(bank, li, k)!;
      const r = { id: g.id, name: g.name_ru.replace(/^Лексика:\s*/, ""), c: 0, n: 0 };
      for (const x of st.core) { const it = st.items[x.id] as CoreItem; const a = st.answers[x.id]; if (!it || !a || it.group !== g.id || !x.ph?.startsWith("v")) continue; r.n++; if (a.ok) r.c++; else vweak.add(it.topic_ru); }
      return r;
    }).filter((r) => r.n > 0);
    if (kinds.length) vlevels.push({ level: PL_LEVELS[li], warm: vf !== null && li < vf, kinds });
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
    families: [...fam.values()].filter((f) => f.all[1] > 0), vlevels, vweak: [...vweak],
    repeats: repeats(st),
    forms: (() => {
      const ch = stat(st, (it, x) => it.skill === "grammar" && !x.ph?.startsWith("v") && it.type === "mcq"), ty = stat(st, (it, x) => it.skill === "grammar" && !x.ph?.startsWith("v") && it.type !== "mcq");
      return { choice: [ch.c, ch.n] as [number, number], typed: [ty.c, ty.n] as [number, number] };
    })(),
    core, reading, listening, readStep: skillStep(reading, st.level), listenStep: skillStep(listening, st.level),
  };
}

/** Ответы по текстам, сгруппированные по уровню: уровень → [верно, всего]. */
export function byLevelOf(st: PState, ids: string[]) {
  const r: Record<string, [number, number]> = {};
  for (const id of ids) {
    const it = st.items[id] as ReadItem | ListenItem; if (!it) continue;
    const row = (r[it.level] ??= [0, 0]);
    for (const q of it.questions) { row[1] += 1; if (st.answers[q.id]?.ok) row[0] += 1; }
  }
  return r;
}
/** Уровень задания письма и говорения: средний из трёх навыков, на которые раздел опирается.
 *  Письмо — грамматика, лексика, чтение; говорение — грамматика, лексика, аудирование. Ступень с плюсом → сложное задание уровня. */
export function wsStep(st: PState, kind: "writing" | "speaking"): number | null {
  const r = skillStep(byLevelOf(st, kind === "writing" ? st.rdone : st.ldone));
  const xs = [st.step, st.vstep, r].filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs.length === 3 ? xs[1] : xs.length === 2 ? Math.floor((xs[0] + xs[1]) / 2) : xs[0];
}

/** Ступень по чтению/аудированию: самый высокий уровень, где верно 50%+ (тексты одного уровня — вместе); там 80%+ → X+. */
function skillStep(r: Record<string, [number, number]>, level?: PLevel) {
  void level;
  const lv = PL_LEVELS.filter((l) => r[l]?.[1]);
  if (!lv.length) return null;
  const ok = lv.filter((l) => r[l][0] / r[l][1] >= 0.5);
  if (!ok.length) return Math.max(0, BASE[lv[0]] - 1);
  const best = ok[ok.length - 1], p = r[best][0] / r[best][1];
  return p >= 0.8 ? Math.min(8, BASE[best] + 1) : BASE[best];
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
