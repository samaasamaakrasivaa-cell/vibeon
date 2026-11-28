// Вводный тест A1–C1: типы банка, «лесенка» ядра, подбор текстов, проверка ответов и подсказки для учителя.
// Чистые функции без базы — чтобы логику можно было проверить отдельно (scripts/placement-sim.ts).

import { fixWords, parseFixAnswer, replaceFixFragment } from "./fix-answer";

export const PL_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type PLevel = (typeof PL_LEVELS)[number];
/** Шкала из 9 ступеней — та же, что в маршруте. */
export const STEPS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1"] as const;
export type Sub = (typeof STEPS)[number];

export type Q = { id: string; q: string; options: string[]; answer: number; topic_id: string; checks?: string; explain_ru: string };
type Base = { id: string; level: PLevel; band: number; topic_en: string; topic_ru: string; explain_ru?: string };
export type CoreItem = Base & {
  skill: "grammar" | "vocabulary"; topic_id: string; type: "mcq" | "gap" | "wordform" | "transform" | "brackets" | "fix";
  q: string; options?: string[]; answer?: number; accept?: string[]; base?: string; key?: string; frame?: string; explain_ru: string;
  instruction_en?: string;
  span?: [number, number]; wrong?: string; // «найди и исправь»: слова с ошибкой (номера слов в q, с 0) и сама ошибка
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
export type Bank = { groups: Group[]; families?: Family[]; core: CoreItem[]; reading: ReadItem[]; listening: ListenItem[]; writing: WriteItem[]; speaking: SpeakItem[];
  fix?: CoreItem[]; // «найди и исправь» (v6): собраны из заданий с вариантами — в предложение подставлен неверный вариант
  prereq?: Record<string, string[]>; // карта связей тем: тема → темы, на которые она опирается
};

export const SECTIONS = ["core", "vocab", "reading", "listening", "writing", "speaking"] as const;
export type Section = (typeof SECTIONS)[number];

export type Ph = "w" | "l" | "d" | "u" | "s" | "x" | "b" | "r" | "f" | "vw" | "vm" | "vu" | "vd" | "vl" | "vc" | "z" | "vz"
  | "q" | "t" | "c" | "g"; // v6: q — серия лесенки, t — проверка темы, c — контрольное после ошибки, g — пробел базы уровнем ниже // z / vz — дополнительное задание другого уровня от учителя
export type Ans = { v: string | number | null; ok: boolean | null; ms?: number; dk?: boolean; h?: boolean; tr?: (string | number)[];
  cf?: 0 | 1; // v6: уверен (1) / не уверен (0) — на проверке тем
  ty?: boolean; // засчитано с опечаткой
}; // dk — «Не знаю», h — открыл подсказку, tr — что выбирал до итогового ответа
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
  diagTopics?: { t: string; g: string }[]; // темы на момент начала подробной проверки v6
  ladderTopicIds?: Partial<Record<number, string[]>>; // темы ступеней, на которые заходила лесенка v6
  fb?: boolean; // уже переходили на уровень ниже (погорячились)
  up?: boolean; // уже переходили на уровень выше (срез выше сдан уверенно) — после этого вниз не спускаемся
  ups?: number; // сколько раз поднимались: уровень за уровнем, пока ученик уверенно делает задания (B1 → B2 → C1)
  bdx?: boolean; // был пограничным на одном из прошлых уровней (для длины теста и отчёта)
  sg?: string[]; // группы уровня выше, из которых берётся срез (выбраны один раз)
  bd?: "l" | "s"; // пограничный ученик (уровень проверки и уровень выше): замечен на поиске уровня (l) или на срезе (s)
  closed?: string[]; // завершённые разделы после ядра (между открытыми можно переключаться)
  seen?: string[]; // задания, которые ученик видел в прошлых прохождениях — при перепрохождении берём другие
  answers: Record<string, Ans>; // по id задания ядра и id вопроса чтения/аудирования
  reading: string[]; listening: string[];
  rdone: string[]; ldone: string[]; // тексты и записи, на которые ученик уже ответил
  plays: Record<string, number>;
  writing?: { id: string; text: string };
  speaking?: { id: string; rec: Record<string, string> }; // номер вопроса → ключ записи
  // дополнительное задание письма/говорения уровнем выше или ниже (даёт учитель): прошлые задания с ответами и оценками
  wsPrev?: { rubric?: 1 | 2; kind: "writing" | "speaking"; id: string; text?: string; rec?: Record<string, string>; rerec?: Record<string, number>; peek?: string[]; marks?: Record<string, number>; points?: boolean[] }[];
  wsExtra?: { writing?: number; speaking?: number }; // направление: 1 — выше, -1 — ниже (одно на навык)
  level?: PLevel; step?: number; // level — уровень текстов (меньший из грамматики и лексики), step — итог грамматики
  vstep?: number; // итог лексики
  // тест по разделам: какие разделы входят (нет — все), когда каждый закончен (мс), уровень грамматики без раздела грамматики
  parts?: Section[];
  sdates?: Partial<Record<Section, number>>;
  base?: number; // ступень грамматики, если сама грамматика не проверяется: по прошлому тесту или по выбору учителя
  baseFrom?: "test" | "teacher";
  added?: number; // когда учитель добавил разделы в уже пройденный тест
  xq?: { kind: "core" | "vocab"; level: PLevel; ids: string[] }; // дополнительное задание учителя: грамматика или лексика другого уровня
  xt?: { kind: "reading" | "listening"; level: PLevel }; // дополнительный текст другого уровня (после него раздел закрывается)
  xs?: { kind: Section; level: PLevel; at: number }[]; // история дополнительных заданий (для разбора)
  xdone?: Section; // какое дополнительное задание только что выполнено — для уведомления учителю
  // v6 (взрослые): лесенка сериями по 3 → проверка тем найденного уровня
  v6?: boolean;
  ld?: { L: number; ids: string[] }[]; // серии лесенки по порядку
  lv?: Record<number, "up" | "down">; // решение по уровню лесенки
  bt?: string[]; // темы базы уровнем ниже, которые проверяем (выбраны один раз)
  cx?: string[]; // темы, для которых контрольных заданий в банке больше нет
};

/** expected: ожидаемый уровень от учителя (A1 / B1 / B2) — тогда без разминки, поиск начинается с него. */
export const EXPECT = { A1: 0, B1: 2, B2: 3 } as const; // индекс уровня в PL_LEVELS
export type Expect = keyof typeof EXPECT;
/** Teens: «начинающий» — A1, «средний» — A2–B1 (старт с A2), «продвинутый» — B2. */
const EXPECT_TEEN: Record<Expect, number> = { A1: 0, B1: 1, B2: 3 };
export const emptyState = (expected?: Expect | null, track: "adult" | "teen" = "adult"): PState => track === "adult" ? {
  // взрослые — v6: лесенка сериями без разминки; старт — с ожидаемого уровня, если учитель его указал, иначе с B1
  v: 1, v6: true, section: "intro", items: {}, core: [], answers: {}, reading: [], listening: [], rdone: [], ldone: [], plays: {},
  start: expected && expected in EXPECT ? EXPECT[expected] : 2,
} : ({
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
const SLICE_FROM = 0.8, SLICE_GROUPS = 4, SLICE_PER = 2, UP_FROM = 0.7, EDGE_FROM = 0.55, EXTRA = 4, REPEATS = 6, REPEAT_GAP = 3, COVER_MAX = 16, COVER_PER = 3, COVER_MIN = 3;
// уровень сделан на 80%+ — срез уровня выше (8 заданий); срез 70%+ — уровень выше целиком; 55–70% — ещё 4 задания уровня выше и решение по сумме
// шаг вверх: раздел уровня сделан без ошибок (3/3, 4/4) — 1–2 сложных задания этого раздела уровнем выше (второе — если первое верно)
const STEP_PER = 2, STEP_MAX = 4, STEP_FROM = 3;
// пограничный ученик (поиск: уровень выше 2 из 3; или срез уровня выше 55–70%): уровень проверки — полностью, и в каждом разделе
// задания уровнем выше: раздел без ошибок — 2, есть ошибка, но 60%+ — 1 (верно — ещё 1), ниже — 0. Итог по всем заданиям уровня выше:
// 70%+ — проверяем уровень выше подробно, 55–70% — «плюс», ниже — уровень проверки
const BORDER_MORE = 25, BORDER_UP_MORE = 20;
const PASS = 0.6; // поиск уровня: 2 из 3 (3 из 4…)

// ───────── Ядро: поиск уровня → подробная проверка по группам ─────────

type Stat = { n: number; c: number };
const stat = (st: PState, f: (it: CoreItem, x: PState["core"][number]) => boolean): Stat => {
  let n = 0, c = 0;
  for (const x of st.core) { const it = st.items[x.id] as CoreItem; if (!it || !f(it, x) || !st.answers[x.id]) continue; n++; if (st.answers[x.id].ok) c++; }
  return { n, c };
};
/** Грамматические группы уровня, опорная — первой (лексика проверяется отдельным блоком). */
const groupsOf = (bank: Bank, li: number) =>
  bank.groups.filter((g) => g.level === PL_LEVELS[li] && g.kind === "grammar").sort((a, b) => Number(b.anchor) - Number(a.anchor));
const inGroup = (st: PState, gid: string) => st.core.filter((x) => (st.items[x.id] as CoreItem)?.group === gid).length;

/** Ответы поиска уровня (разминка и лесенка) на уровне li — задания из разных групп уровня. */
const ladderStat = (st: PState, li: number) => stat(st, (it, x) => it.level === PL_LEVELS[li] && it.skill === "grammar" && (x.ph === "w" || x.ph === "l"));
/** Уровень на поиске: true — сдан (2 из 3), false — нет, undefined — ещё не ясно. */
function anchorPass(st: PState, bank: Bank, li: number) {
  void bank;
  const s = ladderStat(st, li);
  return s.n >= PER_GROUP ? s.c / s.n >= PASS : undefined;
}
/** Задание поиска уровня: из группы уровня, где на поиске заданий ещё не было (случайной), — три задания уровня из трёх разных групп,
 *  чтобы одна трудная тема не решала за весь уровень. */
function ladderPick(st: PState, bank: Bank, li: number, rnd: () => number): CoreItem | null {
  const cnt = (gid: string) => st.core.filter((x) => (x.ph === "w" || x.ph === "l") && (st.items[x.id] as CoreItem | undefined)?.group === gid).length;
  const gs = notLast(st, shuffle(groupsOf(bank, li), rnd)).sort((a, b) => cnt(a.id) - cnt(b.id));
  for (const g of gs) { const it = pickFrom(st, bank, g.id, rnd, "easy"); if (it) return it; }
  return null;
}
const shuffle = <T,>(xs: T[], rnd: () => number) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Уровень-кандидат по опорным группам (null — поиск ещё идёт); next — какой уровень проверять дальше. */
function locate(st: PState, bank: Bank): { cand: number | null; next: number | null; border?: boolean } {
  let L = st.start ?? 2;
  for (let guard = 0; guard < 10; guard++) {
    const p = anchorPass(st, bank, L);
    if (p === undefined) return { cand: null, next: L };
    if (p) {
      if (L === 4) return { cand: 4, next: null };
      // Teens: верхний уровень поиска — B2 (заданий C1 в банке немного, угаданные 2 из 3 не должны давать C1);
      // B2 сдан — проверяем его подробно, а C1 — серией заданий по разделам после проверки
      if (st.track === "teen" && L === 3) return { cand: 3, next: null, border: hasUpper(bank, 3) };
      const up = anchorPass(st, bank, L + 1);
      // уровень выше не сдан, но 1 из 3 там верно — пограничный: после проверки уровня — серия заданий уровнем выше по разделам
      if (up === false) { const s = ladderStat(st, L + 1); return { cand: L, next: null, border: s.c > 0 && hasUpper(bank, L) }; }
      // уровень выше: 2 из 3 или 3 из 3 — сдан, идём ещё выше (договорённость: тройка решает, вверх или вниз)
      L++;
    }
    else { if (L === 0) return { cand: 0, next: null }; if (anchorPass(st, bank, L - 1) === true) return { cand: L - 1, next: null }; L--; }
  }
  return { cand: L, next: null };
}

/** Группа и тема последнего задания — чтобы следующее не было на ту же тему. */
const lastOf = (st: PState) => { const x = st.core[st.core.length - 1]; const it = x ? (st.items[x.id] as CoreItem | undefined) : undefined; return { group: it?.group, topic: it?.topic_id }; };
/** Порядок групп: группа последнего задания — в конец, чтобы две одинаковые темы не шли подряд. */
const notLast = <T extends { id: string }>(st: PState, gs: T[]) => { const g = lastOf(st).group; return [...gs.filter((x) => x.id !== g), ...gs.filter((x) => x.id === g)]; };

/** pref: easy — простые задания уровня (band 1, сам уровень X), hard — сложные (band 2–3, X+). */
function pickFrom(st: PState, bank: Bank, gid: string, rnd: () => number, pref?: "easy" | "hard", topicRe?: RegExp, rank?: (it: CoreItem) => number): CoreItem | null {
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
  if (rank && pool.length > 1) { const m = Math.min(...pool.map(rank)); pool = pool.filter((x) => rank(x) === m); }
  return pool[Math.floor(rnd() * pool.length)];
}

const levelAcc = (st: PState, li: number) => stat(st, (it, x) => it.level === PL_LEVELS[li] && it.skill === "grammar" && !x.ph?.startsWith("v"));

/** Следующее задание ядра; null — ядро закончено. Отмечает в st этап проверки (diag, fb). */
export function nextCore(st: PState, bank: Bank, rnd: () => number = Math.random): { item: CoreItem; ph: Ph } | null {
  if (st.v6) return nextCoreV6(st, bank, rnd);
  // тест может быть длиннее: каждый подъём на уровень выше и пограничная проверка добавляют заданий — важнее точный итог
  const ups = st.ups ?? (st.up ? 1 : 0);
  const cap = (st.track === "teen" ? CORE_MAX_TEEN : CORE_MAX) + (st.bd || st.bdx ? BORDER_MORE : 0) + ups * BORDER_UP_MORE;
  // лимит длины — для основной проверки; добор по разделам с малым числом ответов идёт и после него (не больше COVER_MAX)
  // каждая группа уровня получает свои 3 задания и после лимита (не больше COVER_MAX сверх него)
  if (st.core.length >= cap) return st.diag !== undefined && st.core.length < cap + COVER_MAX ? detailPick(st, bank, st.diag, rnd) ?? cover(st, bank, st.diag, rnd) : null;
  const warm = st.warm ?? 0;
  if (st.core.length < warm) {
    // два задания разминки одного уровня подряд — второе из другой группы, чтобы тема не повторялась
    const W = warmOf(st), i = st.core.length, lv = W[i];
    const k = W.slice(0, i).filter((x) => x === lv).length; // какое по счёту задание этого уровня в разминке
    const it = st.track === "teen" && lv === 0
      ? pickFrom(st, bank, groupsOf(bank, lv)[Math.min(k, groupsOf(bank, lv).length - 1)].id, rnd, "easy") // Teens A1: группы по порядку — база
      : ladderPick(st, bank, lv, rnd); // разминка — из разных групп уровня
    if (it) return { item: it, ph: "w" };
  }
  if (st.diag === undefined) {
    const { cand, next, border } = locate(st, bank);
    if (next !== null) {
      const it = ladderPick(st, bank, next, rnd);
      if (it) return { item: it, ph: "l" };
    }
    st.diag = cand ?? next ?? 2;
    if (border) st.bd = "l";
  }
  // подробная проверка уровня: по 3 задания из каждой группы, по кругу
  const D = st.diag!;
  const dItems = st.core.filter((x) => x.ph === "d" && (st.items[x.id] as CoreItem)?.level === PL_LEVELS[D]);
  const dAcc = stat(st, (it, x) => x.ph === "d" && it.level === PL_LEVELS[D]);
  // провал на подробной проверке — спускаемся на уровень; если и там провал — ещё ниже (угаданные опорные задания не должны «застрять» наверху)
  if (!st.up && D > 0 && dAcc.n >= FALLBACK_AFTER && dAcc.c / dAcc.n < FALLBACK_BELOW) { st.fb = true; st.bd = undefined; st.diag = D - 1; return nextCore(st, bank, rnd); } // провал — не пограничный
  void dItems;
  {
    // добор разделов — не в конце пачкой, а вперемешку с проверкой: после первого круга — через задание
    const roundOne = groupsOf(bank, D).every((g) => inGroup(st, g.id) >= 1);
    if (roundOne && st.core[st.core.length - 1]?.ph === "d") { const f = cover(st, bank, D, rnd, true, "same"); if (f) return f; }
    const d = detailPick(st, bank, D, rnd); if (d) return d;
  }
  // уровень проверки доводим до конца, прежде чем идти выше: добор и повторы после ошибок того же уровня,
  // потом — добор уровнем ниже одной серией (а не по одному заданию между заданиями уровня выше)
  { const o = tail(st, bank, D, rnd); if (o) return o; }
  // шаг вверх по разделам: раздел сделан без ошибок — проверяем его же уровнем выше
  // и так на каждом уровне: поднялись на B2 и делаем его уверенно — так же проверяем C1 (раньше подъём был только один раз)
  if (D < 4 && !st.fb && !st.bd) { const u = stepUp(st, bank, D, rnd); if (u) return u; }
  // уровень сделан уверенно — короткий срез уровня выше; 70%+ — проверяем уровень выше целиком; 55–70% — уточняем ещё 4 заданиями
  // срез — из групп уровня выше, которые ещё не проверялись: опорная группа уже получила 3 задания при поиске уровня
  // и не должна занимать место среза (иначе срез обрывался на 6 заданиях и решение не принималось никогда)
  const sliceGroups = (li: number) => { const all = groupsOf(bank, li); const fresh = all.filter((g) => !g.anchor && inGroup(st, g.id) === 0); return (fresh.length >= SLICE_GROUPS ? fresh : [...fresh, ...all.filter((g) => !fresh.includes(g) && !g.anchor), ...all.filter((g) => g.anchor)]).slice(0, SLICE_GROUPS); };
  if (D < 4 && !st.fb && !st.bd) {
    const atUp = (x: PState["core"][number]) => (st.items[x.id] as CoreItem | undefined)?.level === PL_LEVELS[D + 1];
    const sl = stat(st, (it, x) => (x.ph === "s" || x.ph === "x") && it.level === PL_LEVELS[D + 1]);
    const xs = st.core.filter((x) => x.ph === "x" && atUp(x)).length;
    // группы среза — именно уровня выше текущего (после подъёма срез собирается заново)
    const upIds = new Set(groupsOf(bank, D + 1).map((g) => g.id));
    if (st.sg && !st.sg.every((g) => upIds.has(g))) st.sg = undefined;
    const sGroups = st.sg ?? (st.sg = sliceGroups(D + 1).map((g) => g.id));
    const sliceN = Math.min(SLICE_GROUPS, sGroups.length) * SLICE_PER;
    const slAsked = st.core.filter((x) => x.ph === "s" && atUp(x)).length;
    if (sl.n >= sliceN || (slAsked > 0 && !sGroups.some((gid) => st.core.filter((x) => x.ph === "s" && (st.items[x.id] as CoreItem)?.group === gid).length < SLICE_PER && pickFrom(st, bank, gid, rnd, "easy")))) {
      const p = sl.c / sl.n;
      if (p >= UP_FROM && (xs === 0 || xs >= EXTRA)) { climb(st, D); return nextCore(st, bank, rnd); }
      // 55–70% — пограничный: дальше каждый раздел и уровнем выше (старые прохождения с начатым добором доводим по-старому)
      if (xs === 0 && p >= EDGE_FROM && hasUpper(bank, D)) { st.bd = "s"; return nextCore(st, bank, rnd); }
      if (xs > 0 && xs < EXTRA) {
        const gs = notLast(st, [...groupsOf(bank, D + 1)].sort((a, b) => inGroup(st, a.id) - inGroup(st, b.id))); // сначала группы, где заданий меньше; не та же, что только что
        for (const g of gs) {
          const it = pickFrom(st, bank, g.id, rnd);
          if (it) return { item: it, ph: "x" };
        }
      }
    } else {
      const acc = levelAcc(st, D);
      if (acc.n && acc.c / acc.n >= SLICE_FROM) {
        const up = notLast(st, shuffle(groupsOf(bank, D + 1).filter((g) => sGroups.includes(g.id)), rnd));
        const inSlice = (gid: string) => st.core.filter((x) => x.ph === "s" && (st.items[x.id] as CoreItem)?.group === gid).length;
        for (let round = 1; round <= SLICE_PER; round++)
          for (const g of up) {
            if (inSlice(g.id) >= round) continue;
            const it = pickFrom(st, bank, g.id, rnd, "easy");
            if (it) return { item: it, ph: "s" };
          }
      }
    }
  }
  // пограничный: задания уровнем выше по разделам вперемешку с повторами и добором уровня проверки
  if (st.bd && D < 4) {
    const b = border(st, bank, D, rnd, false) ?? border(st, bank, D, rnd, false, false); if (b) return b;
    const u = upperStat(st, D);
    if (u.n >= 4 && u.c / u.n >= UP_FROM) { climb(st, D); return nextCore(st, bank, rnd); }
    return null;
  }
  return tail(st, bank, D, rnd);
}

/** Подъём на уровень выше: подробная проверка нового уровня, и от него — снова срез, шаги вверх и пограничная проверка. */
function climb(st: PState, D: number) {
  st.up = true; st.ups = (st.ups ?? 0) + 1;
  if (st.bd) st.bdx = true;
  st.bd = undefined; st.sg = undefined; st.diag = D + 1;
}

/** Подробная проверка уровня: каждая группа тем — минимум 3 задания (1 простое, потом 2 сложных), по кругу и вперемешку:
 *  подряд не идут задания одной группы. Внутри группы — тема того раздела (времена, условные…), где ответов на уровне пока меньше всего,
 *  чтобы и в «Грамматике по разделам» у каждого раздела набралось 3 ответа без добора в конце. */
function detailPick(st: PState, bank: Bank, D: number, rnd: () => number): { item: CoreItem; ph: Ph } | null {
  const gs = groupsOf(bank, D);
  const fams = bank.families ?? [];
  const famOf = new Map(fams.flatMap((f) => f.topics.map((t) => [t, f] as const)));
  const famN = new Map<string, number>();
  for (const x of st.core) { const it = st.items[x.id] as CoreItem | undefined; if (!it || it.level !== PL_LEVELS[D] || x.ph?.startsWith("v")) continue; const f = famOf.get(it.topic_id); if (f) famN.set(f.id, (famN.get(f.id) ?? 0) + 1); }
  const rank = (it: CoreItem) => { const f = famOf.get(it.topic_id); return f ? Math.min(famN.get(f.id) ?? 0, COVER_MIN) : COVER_MIN; };
  for (let round = 1; round <= PER_GROUP; round++) {
    for (const g of notLast(st, shuffle(gs, rnd))) { // группы вперемешку, не та же, что только что
      if (inGroup(st, g.id) >= round) continue;
      const it = pickFrom(st, bank, g.id, rnd, round === 1 ? "easy" : "hard", undefined, rank);
      if (it) return { item: it, ph: "d" };
    }
  }
  return null;
}

/** Конец проверки: повторы после ошибок и добор разделов — через одно, чтобы не шли подряд. */
function tail(st: PState, bank: Bank, D: number, rnd: () => number) {
  const last = st.core[st.core.length - 1]?.ph;
  const same = last === "f" ? repeat(st, bank, D, rnd) ?? cover(st, bank, D, rnd, false, "same") : cover(st, bank, D, rnd, false, "same") ?? repeat(st, bank, D, rnd);
  return same ?? cover(st, bank, D, rnd, false, "lower");
}

/** Повтор после ошибки: на тему, где ученик ошибся, — ещё одно задание (проверить, случайность или пробел). */
function repeat(st: PState, bank: Bank, D: number, rnd: () => number): { item: CoreItem; ph: Ph } | null {
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
  return null;
}

const UPPER_PH = new Set<Ph | undefined>(["s", "x", "u", "b"]);
/** Все задания уровня выше после поиска: срез, добор, шаги вверх, пограничные по разделам. */
const upperStat = (st: PState, D: number) => stat(st, (it, x) => it.level === PL_LEVELS[D + 1] && it.skill === "grammar" && UPPER_PH.has(x.ph));
/** У разделов есть темы уровня выше — пограничную проверку есть из чего собрать. */
const hasUpper = (bank: Bank, D: number) => {
  const lv = new Set(bank.core.filter((x) => x.skill === "grammar" && x.level === PL_LEVELS[D + 1]).map((x) => x.topic_id));
  return (bank.families ?? []).some((f) => f.topics.some((t) => lv.has(t)));
};

/** Пограничный ученик: в каждом разделе, где есть темы уровня выше, — задания уровня выше. Сколько — по разделу на уровне проверки:
 *  без ошибок — 2; есть ошибка, но 60%+ — 1, и если оно верно — ещё 1; ниже — 0 (сначала база). ready — только разделы, где на уровне
 *  проверки уже есть 3 ответа (чтобы задания выше шли вперемешку с проверкой, а не после неё). */
function border(st: PState, bank: Bank, D: number, rnd: () => number, ready: boolean, strict = true): { item: CoreItem; ph: Ph } | null {
  const fams = bank.families ?? [];
  const topicLv = new Map(bank.core.filter((x) => x.skill === "grammar").map((x) => [x.topic_id, PL_LEVELS.indexOf(x.level)] as const));
  const used = new Set(st.core.map((x) => x.id));
  const topicOf = (id: string) => (st.items[id] as CoreItem | undefined)?.topic_id ?? "";
  const famOf = new Map(fams.flatMap((f) => f.topics.map((t) => [t, f.id] as const)));
  const lastFam = famOf.get(lastOf(st).topic ?? "");
  const cands: { f: Family; up: string[]; mine: PState["core"] }[] = [];
  for (const f of fams) {
    const up = f.topics.filter((t) => topicLv.get(t) === D + 1);
    if (!up.length) continue;
    const base = stat(st, (it, x) => it.skill === "grammar" && !x.ph?.startsWith("v") && !UPPER_PH.has(x.ph) && f.topics.includes(it.topic_id) && it.level === PL_LEVELS[D]);
    const hasBase = f.topics.some((t) => topicLv.get(t) === D);
    if (ready && hasBase && base.n < COVER_MIN) continue;
    const mine = st.core.filter((x) => UPPER_PH.has(x.ph) && up.includes(topicOf(x.id)));
    if (mine.some((x) => !st.answers[x.id])) continue; // ждём ответа
    const acc = base.n ? base.c / base.n : 1;
    const quota = !hasBase || !base.n ? 1 : acc === 1 ? 2 : acc >= PASS ? (mine.length && mine.every((x) => st.answers[x.id]?.ok) ? 2 : 1) : 0;
    if (mine.length < quota) cands.push({ f, up, mine });
  }
  const order = shuffle(cands, rnd);
  for (const c of [...order.filter((x) => x.f.id !== lastFam), ...order.filter((x) => x.f.id === lastFam)]) {
    let pool = bank.core.filter((x) => x.skill === "grammar" && c.up.includes(x.topic_id) && !used.has(x.id));
    const unseen = st.seen?.length ? pool.filter((x) => !st.seen!.includes(x.id)) : []; if (unseen.length) pool = unseen;
    const band = pool.filter((x) => (c.mine.length ? x.band > 1 : x.band === 1)); if (band.length) pool = band; // первое — простое уровня выше, второе — сложнее
    const fresh = pool.filter((x) => !c.mine.some((m) => topicOf(m.id) === x.topic_id)); if (fresh.length) pool = fresh; // другая тема раздела
    const og = pool.filter((x) => x.group !== lastOf(st).group); if (og.length) pool = og; else if (strict) continue; // не та же группа тем
    if (!pool.length) continue;
    return { item: pool[Math.floor(rnd() * pool.length)], ph: "b" };
  }
  return null;
}

/** Шаг вверх: раздел (времена, условные, пассив…) на уровне проверки сделан без ошибок, хотя бы 3 из 3 —
 *  сложное задание этого раздела уровнем выше; верно — ещё одно. Так видно, какие разделы ученик уже держит выше уровня. */
function stepUp(st: PState, bank: Bank, D: number, rnd: () => number): { item: CoreItem; ph: Ph } | null {
  const fams = bank.families ?? [];
  const done = st.core.filter((x) => x.ph === "u" && (st.items[x.id] as CoreItem | undefined)?.level === PL_LEVELS[D + 1]);
  if (!fams.length || done.length >= STEP_MAX) return null;
  const topicLv = new Map(bank.core.filter((x) => x.skill === "grammar").map((x) => [x.topic_id, PL_LEVELS.indexOf(x.level)] as const));
  const used = new Set(st.core.map((x) => x.id));
  const lastTopic = lastOf(st).topic;
  for (const f of fams) {
    const upTopics = f.topics.filter((t) => topicLv.get(t) === D + 1);
    if (!upTopics.length) continue;
    const s2 = stat(st, (it, x) => it.skill === "grammar" && !x.ph?.startsWith("v") && x.ph !== "u" && f.topics.includes(it.topic_id) && it.level === PL_LEVELS[D]);
    if (s2.n < STEP_FROM || s2.c < s2.n) continue;
    const mine = done.filter((x) => f.topics.includes((st.items[x.id] as CoreItem)?.topic_id));
    if (mine.length >= STEP_PER) continue;
    if (mine.length && !mine.every((x) => st.answers[x.id]?.ok)) continue; // первое мимо — второе не даём
    if (mine.length && !st.answers[mine[mine.length - 1].id]) continue; // ответ ещё не пришёл
    let pool = bank.core.filter((x) => x.skill === "grammar" && upTopics.includes(x.topic_id) && !used.has(x.id));
    const hard = pool.filter((x) => x.band > 1); if (hard.length) pool = hard;
    const unseen = st.seen?.length ? pool.filter((x) => !st.seen!.includes(x.id)) : []; if (unseen.length) pool = unseen;
    const fresh = pool.filter((x) => !mine.some((m) => (st.items[m.id] as CoreItem)?.topic_id === x.topic_id)); if (fresh.length) pool = fresh; // второе — по другой теме раздела, если есть
    const other = pool.filter((x) => x.topic_id !== lastTopic); if (other.length) pool = other;
    pool = pool.filter((x) => x.group !== lastOf(st).group); // не та же группа тем, что только что (раздел подождёт)
    if (!pool.length) continue;
    return { item: pool[Math.floor(rnd() * pool.length)], ph: "u" };
  }
  return null;
}

/** Добор в конце грамматики: в каждом большом разделе (времена, условные, глагольные модели…) должно быть хотя бы 3 ответа
 *  на уровне проверки (или уровнем ниже, если на этом уровне у раздела нет тем); 1 из 2 — спорно, даём ещё одно. */
function cover(st: PState, bank: Bank, D: number, rnd: () => number, strict = false, only?: "same" | "lower"): { item: CoreItem; ph: Ph } | null {
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
    if (L < 0 || (only === "same" && L !== D) || (only === "lower" && L === D)) continue;
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
    const og = pool.filter((x) => x.group !== lastOf(st).group); if (og.length) pool = og; else if (strict) continue; // и не та же группа тем
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
  if (st.v6) return resultV6(st, bank);
  if (st.diag === undefined) return 0;
  const D = st.diag, L = PL_LEVELS[D], b = BASE[L];
  const easy = stat(st, (it) => it.level === L && it.band === 1 && it.skill === "grammar"), hard = stat(st, (it) => it.level === L && it.band > 1 && it.skill === "grammar");
  const all = levelAcc(st, D);
  const pe = easy.n >= 3 ? easy.c / easy.n : all.n ? all.c / all.n : 0;
  const ph = hard.n ? hard.c / hard.n : 0;
  if (pe < 0.6) return Math.max(0, b - 1);
  if (D === 4) return 8;
  // «плюс» — сложные задания уровня в основном верны, или уровень выше «почти» сдан: срез, добор к нему и шаги вверх — от 55%
  const upper = upperStat(st, D);
  return ph >= 0.67 || (upper.n >= 3 && upper.c / upper.n >= 0.55) ? b + 1 : b;
}

/** Доля пройденного ядра — для полоски без цифр. */
export function coreProgress(st: PState, bank: Bank) {
  const done = st.core.filter((x) => st.answers[x.id]).length;
  let rem: number;
  if (st.v6) rem = remainingV6(st, bank);
  else if (st.diag === undefined) rem = Math.max(0, (st.warm ?? 0) - st.core.length) + 4 + groupsOf(bank, st.start ?? 2).length * PER_GROUP - 3;
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

const FIX_EXP: [RegExp, string[]][] = [
  [/\bcan't\b/g, ["cannot", "can not"]], [/\bwon't\b/g, ["will not"]], [/\bshan't\b/g, ["shall not"]], [/n't\b/g, [" not"]],
  [/'m\b/g, [" am"]], [/'re\b/g, [" are"]], [/'ve\b/g, [" have"]], [/'ll\b/g, [" will"]],
];
const EXP: [RegExp, string[]][] = [
  ...FIX_EXP, [/'d\b/g, [" had", " would"]], [/\b(it|he|she|that|there|what|who)'s\b/g, ["$1 is", "$1 has"]],
];
export function norm(s: string) {
  return s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, " ").trim().replace(/[.,!?;:]+$/, "").trim();
}
function variants(s: string, expansions: [RegExp, string[]][]) {
  let out = new Set([norm(s)]);
  for (const [re, reps] of expansions) {
    const next = new Set<string>();
    for (const v of out) { if (re.test(v)) { re.lastIndex = 0; for (const r of reps) next.add(v.replace(re, r).replace(/\s+/g, " ").trim()); } next.add(v); re.lastIndex = 0; }
    out = next;
  }
  return out;
}
function matchesText(input: string, accept: string[], expansions: [RegExp, string[]][]) {
  const a = variants(input, expansions);
  return accept.some((x) => [...variants(x, expansions)].some((v) => a.has(v)));
}
export function checkText(input: string, accept: string[]) {
  return matchesText(input, accept, EXP);
}

const contractedFixAux = { "there is": "There's", is: "'s", has: "'s", had: "'d", would: "'d" } as const;
// Проверенные контексты, где сокращение сохраняет форму. Выводим вариант из
// разрешённой полной формы, чтобы не превращать «'s sleeping» в «has sleeping».
const fixAux = new Map<string, keyof typeof contractedFixAux>([
  ["F-G-A1-09", "there is"], ["F-G-A1-29", "is"], ["F-G-A2-07", "is"],
  ["F-G-B1-29", "is"], ["F-G-B1-68", "is"], ["F-G-B2-67", "is"], ["F-G-B2-17", "is"],
  ["F-G-B1-118", "has"],
  ["F-G-B1-05", "had"], ["F-G-B1-55", "had"], ["F-G-B2-55", "had"], ["F-G-B2-27", "had"],
  ["F-G-C1-54", "had"], ["F-G-B1-135", "had"], ["F-G-B1-155", "had"],
  ["F-G-B2-06", "would"], ["F-G-C1-53", "would"], ["F-G-B1-134", "would"],
  ["F-G-B1-154", "would"], ["F-G-B1-162", "would"],
]);
export function acceptedFixCorrections(item: CoreItem) {
  const bankAnswers = item.accept ?? [];
  // The source bank includes “was taking”, but “we was taking” fails subject–verb agreement.
  // Keep the exception local to this context and preserve other recorded alternatives.
  const subject = item.id === "F-G-C1-16" && item.span ? fixWords(item.q)[item.span[0] - 1]?.toLowerCase() : undefined;
  const accepted = subject === "we" ? bankAnswers.filter((text) => norm(text) !== "was taking") : bankAnswers;
  const aux = fixAux.get(item.id);
  if (!aux) return accepted;
  const contractions = accepted.map(norm)
    .filter((text) => text === aux || text.startsWith(aux + " "))
    .map((text) => contractedFixAux[aux] + text.slice(aux.length));
  return [...new Set([...accepted, ...contractions])];
}

function checkFix(item: CoreItem, value: string | number) {
  const answer = parseFixAnswer(value);
  const errorSpan = item.span;
  if (!answer?.text || !errorSpan) return false;
  const words = fixWords(item.q);
  if (answer.span[1] >= words.length || errorSpan[0] < 0 || errorSpan[1] >= words.length || errorSpan[0] > errorSpan[1]) return false;
  const accepted = acceptedFixCorrections(item);
  // Старый клиент передавал одно слово, но ввод относился ко всей ошибочной части.
  const [start] = answer.span;
  if (answer.legacy && start >= errorSpan[0] && start <= errorSpan[1] && matchesText(answer.text, accepted, FIX_EXP)) return true;
  const corrected = replaceFixFragment(words, answer.span, answer.text);
  const expected = accepted.map((text) => replaceFixFragment(words, errorSpan, text));
  // Не раскрываем неоднозначные сокращения в обе стороны при сравнении.
  return matchesText(corrected, expected, FIX_EXP);
}
export function checkCore(item: CoreItem, v: string | number | null) {
  if (v === null || v === "") return false;
  if (item.type === "mcq") return Number(v) === item.answer;
  if (item.type === "fix") return checkFix(item, v);
  return checkText(String(v), item.accept ?? []);
}

/** Опечатка в слове при верной грамматической форме: слово от 5 букв, окончание (последние 3 буквы) совпадает,
 *  расстояние 1 (от 8 букв — 2). Короткие слова и окончания (has/had, -ed/-ing) так не прощаются. */
export function typoOk(input: string, accept: string[]) {
  const a = norm(input).split(" ");
  const dist = (x: string, y: string) => {
    const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
    for (let j = 1; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[x.length][y.length];
  };
  return accept.some((acc) => {
    const b = norm(acc).split(" ");
    if (a.length !== b.length) return false;
    let typos = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const w = b[i];
      if (w.length < 5 || a[i].slice(-3) !== w.slice(-3)) return false;
      const dd = dist(a[i], w);
      if (dd > (w.length >= 8 ? 2 : 1)) return false;
      typos++;
    }
    return typos > 0 && typos <= 1;
  });
}

// ───────── Сводка для учителя ─────────

export type GroupRes = { id: string; name: string; what: string; kind: "grammar" | "vocabulary"; level: PLevel; c: number; n: number; dk: number };
export type Summary = {
  coreStep: number; level: PLevel; diag: PLevel | null; fb: boolean; up: boolean; bd: boolean;
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
  v6?: V6Summary; // взрослые v6: лесенка сериями и итог по темам
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
    const s = ladderStat(st, li);
    return { level: l, ...s, pass: s.n >= PER_GROUP ? s.c / s.n >= PASS : undefined };
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
    ...(st.v6 ? { v6: summarizeV6(st, bank) } : {}),
    coreStep, level: levelOfStep(coreStep), diag: st.diag !== undefined ? PL_LEVELS[st.diag] : null, fb: !!st.fb, up: !!st.up, bd: !!(st.bd || st.bdx), anchors,
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
export function skillStep(r: Record<string, [number, number]>, level?: PLevel) {
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

// ═════════ v6 (взрослые): лесенка сериями с весом → проверка тем найденного уровня ═════════
// Лесенка: на уровне серии по 3 задания из разных групп (1–2 из 3 — «вписать самому»). Минимум 3 серии, максимум 5;
// решение по всем ответам с весом: вписанный ответ весит больше выбранного (угадать нельзя), ответ быстрее 3 секунд —
// половина веса, «Не знаю» — честный провал. Вверх — уверенно сдал; вниз — уверенно не сдал; иначе ещё серия.
// Найденный уровень: каждая группа тем — минимум 3 задания, каждая тема — минимум 1 (первое — «вписать самому»);
// ошибка или «не уверен» в теме — через 5+ заданий 2 контрольных («найди и исправь» и «вписать самому»);
// пробелы базы: до 3 тем уровнем ниже (ошибки в лесенке и темы-основы тех, что не даются) — по 2 задания.

export const V6 = { MIN: 3, MAX: 5, UP: 0.8, UP_LEAD: 0.65, DOWN: 0.4, DOWN_LEAD: 0.6, END: 0.6, FAST: 3000, GAP: 5, CTRL: 2, BASE_T: 3, BASE_Q: 2, SLOW_T: 25000, SLOW_C: 15000, CAP: 130, LADDER_MAX: 16, PLUS: 0.51 };
const typedIt = (it: CoreItem) => it.type !== "mcq" && it.type !== "fix";
const gItem = (st: PState, id: string) => st.items[id] as CoreItem | undefined;
const isGram = (it?: CoreItem) => !!it && it.skill === "grammar";

/** Ответы серий лесенки на уровне L с весом: доля (0–1), серии (верно из 3) и сколько из них сдано. */
export function ladderLevel(st: PState, L: number) {
  const series = (st.ld ?? []).filter((s) => s.L === L && s.ids.every((id) => st.answers[id]));
  let w = 0, c = 0;
  const cs: { c: number; n: number; typed: number }[] = [];
  for (const s of series) {
    let k = 0, ty = 0;
    for (const id of s.ids) {
      const it = gItem(st, id)!, a = st.answers[id];
      const wt = typedIt(it) ? 1 : 0.8;
      w += wt; if (typedIt(it)) ty++;
      if (a.ok) { k++; c += wt * ((a.ms ?? 99999) < V6.FAST ? 0.5 : 1); }
    }
    cs.push({ c: k, n: s.ids.length, typed: ty });
  }
  const pass = cs.filter((x) => x.c >= 2).length, fail = cs.length - pass;
  return { p: w ? c / w : 0, series: cs, pass, fail };
}
/** Решение по уровню лесенки (null — нужна ещё серия). */
function levelVerdict(st: PState, L: number): "up" | "down" | null {
  const { p, series, pass, fail } = ladderLevel(st, L);
  if (series.length < V6.MIN) return null;
  if (p >= V6.UP || (pass - fail >= 2 && p >= V6.UP_LEAD)) return "up";
  if (p <= V6.DOWN || (fail - pass >= 2 && p < V6.DOWN_LEAD)) return "down";
  if (series.length >= V6.MAX) return p >= V6.END ? "up" : "down";
  return null;
}
const famMap = (bank: Bank) => new Map((bank.families ?? []).flatMap((f) => f.topics.map((t) => [t, f.id] as const)));

/** Задание для серии лесенки: группа, которой ещё не было на этом уровне, другая тема и раздел; 1–2 из 3 — «вписать самому». */
function seriesPick(st: PState, bank: Bank, L: number, ser: { L: number; ids: string[] }, rnd: () => number): CoreItem | null {
  const used = new Set(st.core.map((x) => x.id));
  // Сохраняем один письменный вариант и основу одного «найди и исправь» на каждую тему.
  const level = PL_LEVELS[L];
  const reserve = new Map<string, string>();
  for (const x of bank.core) {
    if (x.level === level && isGram(x) && typedIt(x) && !used.has(x.id) && !reserve.has(x.topic_id)) reserve.set(x.topic_id, x.id);
  }
  const reserveFix = new Map<string, string>();
  for (const x of bank.fix ?? []) {
    const source = x.id.replace(/^F-/, "");
    if (x.level === level && !used.has(source) && !reserveFix.has(x.topic_id)) reserveFix.set(x.topic_id, source);
  }
  const reserved = new Set([...reserve.values(), ...reserveFix.values()]);
  const atL = (st.ld ?? []).filter((s) => s.L === L);
  const k = atL.length - 1; // какая по счёту серия на уровне
  const ladIds = atL.flatMap((s) => s.ids);
  const gUsed = new Set(ladIds.map((id) => gItem(st, id)?.group));
  const tUsed = new Set(ladIds.map((id) => gItem(st, id)?.topic_id));
  const inSer = ser.ids.map((id) => gItem(st, id)!);
  const fam = famMap(bank);
  const fSer = new Set(inSer.map((x) => fam.get(x.topic_id)));
  const gSer = new Set(inSer.map((x) => x.group));
  const typedTarget = k % 2 === 0 ? 1 : 2, typedNow = inSer.filter(typedIt).length, left = 3 - inSer.length;
  const needT = typedTarget - typedNow;
  const wantTyped = needT >= left ? true : needT <= 0 ? false : rnd() < needT / left;
  const last = lastOf(st);
  let pool = bank.core.filter((x) => isGram(x) && x.level === PL_LEVELS[L] && !used.has(x.id) && !gSer.has(x.group) && x.topic_id !== last.topic);
  if (!pool.length) pool = bank.core.filter((x) => isGram(x) && x.level === PL_LEVELS[L] && !used.has(x.id));
  if (!pool.length) return null;
  const pref = (f: (x: CoreItem) => boolean) => { const q = pool.filter(f); if (q.length) pool = q; };
  pref((x) => !reserved.has(x.id));
  pref((x) => !st.seen?.includes(x.id));
  pref((x) => !gUsed.has(x.group));
  pref((x) => !tUsed.has(x.topic_id));
  pref((x) => !fSer.has(fam.get(x.topic_id)));
  pref((x) => typedIt(x) === wantTyped);
  pref((x) => x.band === 1);
  return pool[Math.floor(rnd() * pool.length)];
}

/** Уровень, найденный лесенкой (undefined — лесенка ещё идёт). Двигает лесенку: решает уровень, открывает серию. */
function ladderStep(st: PState, bank: Bank, rnd: () => number): { item: CoreItem; ph: Ph } | number {
  st.ld ??= []; st.lv ??= {};
  for (let guard = 0; guard < 12; guard++) {
    const cur: { L: number; ids: string[] } | undefined = st.ld[st.ld.length - 1];
    if (cur && cur.ids.length < 3) {
      const it = seriesPick(st, bank, cur.L, cur, rnd);
      if (it) {
        (st.ladderTopicIds ??= {})[cur.L] ??= topicsAt(bank, cur.L).map((topic) => topic.t);
        cur.ids.push(it.id);
        return { item: it, ph: "q" };
      }
      if (!cur.ids.length) { st.ld.pop(); st.lv[cur.L] = "down"; } // на уровне нет заданий
    }
    const L = cur ? cur.L : st.start ?? 1;
    if (cur && st.lv[L] === undefined) {
      const d = st.ld.length >= V6.LADDER_MAX ? (ladderLevel(st, L).p >= V6.END ? "up" : "down") : levelVerdict(st, L);
      if (d === null) { st.ld.push({ L, ids: [] }); continue; }
      st.lv[L] = d;
    }
    if (!cur) { st.ld.push({ L, ids: [] }); continue; }
    const d = st.lv[L];
    if (d === "up") { if (L === 4 || st.lv[L + 1] === "down") return L; if (st.lv[L + 1] === "up") return L + 1; st.ld.push({ L: L + 1, ids: [] }); continue; }
    if (L === 0) return 0;
    if (st.lv[L - 1] === "up") return L - 1;
    if (st.lv[L - 1] === "down") return Math.max(0, L - 2);
    st.ld.push({ L: L - 1, ids: [] });
  }
  return st.ld[st.ld.length - 1]?.L ?? 1;
}

/** Ответы по теме (на её уровне), по порядку: позиция в тесте, задание, ответ. */
function topicAnswers(st: PState, topic: string) {
  const out: { i: number; it: CoreItem; a: Ans; ph?: Ph }[] = [];
  st.core.forEach((x, i) => { const it = gItem(st, x.id); const a = st.answers[x.id]; if (isGram(it) && it!.topic_id === topic && a && !x.ph?.startsWith("v") && x.ph !== "z") out.push({ i, it: it!, a, ph: x.ph }); });
  return out;
}
const hasTypedTopic = (st: PState, topic: string) => topicAnswers(st, topic).some((answer) => typedIt(answer.it));
/** Балл темы: верно и уверен — 1, верно, но не уверен — 0,5, неверно — 0. */
export function topicScore(xs: { a: Ans }[]) {
  if (!xs.length) return null;
  return xs.reduce((s, x) => s + (x.a.ok ? (x.a.cf === 0 ? 0.5 : 1) : 0), 0) / xs.length;
}
export const verdictOf = (score: number | null) => (score === null ? null : score >= 0.75 ? "own" : score >= 0.5 ? "part" : "gap");

/** Задание по теме: сначала «вписать самому» (или prefer), не использованное; fix — «найди и исправь». */
function topicPick(st: PState, bank: Bank, topic: string, prefer: "typed" | "required-typed" | "fix" | "mcq" | "hard", rnd: () => number): CoreItem | null {
  const used = new Set(st.core.map((x) => x.id));
  const all = bank.core.filter((x) => isGram(x) && x.topic_id === topic && !used.has(x.id) && !used.has(`F-${x.id}`));
  const fixes = (bank.fix ?? []).filter((x) => x.topic_id === topic && !used.has(x.id) && !used.has(x.id.replace(/^F-/, "")));
  const unseen = <T extends CoreItem>(xs: T[]) => { const u = xs.filter((x) => !st.seen?.includes(x.id)); return u.length ? u : xs; };
  const one = (xs: CoreItem[]) => (xs.length ? unseen(xs)[Math.floor(rnd() * unseen(xs).length)] : null);
  const typed = all.filter(typedIt);
  if (prefer === "fix") return one(fixes) ?? one(typed) ?? one(all);
  if (prefer === "required-typed") return one(typed);
  if (prefer === "typed") return one(typed) ?? one(all);
  if (prefer === "hard") {
    const reserveFix = fixes[0]?.id.replace(/^F-/, "");
    const reserveTyped = typed[0]?.id;
    const spare = all.filter((x) => x.id !== reserveTyped && x.id !== reserveFix);
    return one(spare.filter((x) => x.band > 1)) ?? one(spare);
  }
  return one(all.filter((x) => !typedIt(x))) ?? one(all);
}

/** Темы уровня (по группам уровня). */
const topicsAt = (bank: Bank, D: number) => groupsOf(bank, D).flatMap((g) => g.topics.map((t) => ({ t, g: g.id })));
/** Нужны ли теме контрольные и сколько уже было. */
function needCtrl(st: PState, topic: string) {
  const xs = topicAnswers(st, topic);
  const base = xs.filter((x) => x.ph !== "c" && x.ph !== "g");
  const ctrl = xs.filter((x) => x.ph === "c");
  const trigger = base.some((x) => !x.a.ok || x.a.cf === 0);
  return { trigger, ctrl: ctrl.length, last: xs.length ? xs[xs.length - 1].i : -1 };
}

function nextCoreV6(st: PState, bank: Bank, rnd: () => number): { item: CoreItem; ph: Ph } | null {
  if (st.diag === undefined) {
    const r = ladderStep(st, bank, rnd);
    if (typeof r !== "number") return r;
    st.diag = r;
  }
  const D = st.diag!;
  const n = st.core.length;
  const last = lastOf(st);
  const tops = st.diagTopics ??= topicsAt(bank, D);
  const cx = new Set(st.cx ?? []);
  // 1. контрольные — по темам с ошибкой или «не уверен», через 5+ заданий; сначала давно ждущие
  const ctrlTopics = [...tops.map((x) => x.t), ...(st.bt ?? [])].filter((t) => !cx.has(t)).map((t) => ({ t, ...needCtrl(st, t) })).filter((x) => x.trigger && x.ctrl < V6.CTRL);
  const due = ctrlTopics.filter((x) => n - 1 - x.last >= V6.GAP && x.t !== last.topic).sort((a, b) => a.last - b.last);
  for (const x of due) {
    const it = topicPick(st, bank, x.t, x.ctrl === 0 ? "fix" : "typed", rnd);
    if (it) return { item: it, ph: "c" };
    st.cx = [...(st.cx ?? []), x.t];
  }
  // 2. На найденном уровне каждая тема требует самостоятельного ответа. Подбор на лесенке мог дать только варианты.
  const fam = famMap(bank);
  const errFam = new Set(st.core.filter((y) => st.answers[y.id] && !st.answers[y.id].ok).map((y) => fam.get(gItem(st, y.id)?.topic_id ?? "")).filter(Boolean));
  const fresh = shuffle(tops.filter((x) => !hasTypedTopic(st, x.t)), rnd).sort((a, b) => Number(errFam.has(fam.get(b.t))) - Number(errFam.has(fam.get(a.t))));
  const fr = [...fresh.filter((x) => x.g !== last.group), ...fresh.filter((x) => x.g === last.group)];
  for (const x of fr) { const it = topicPick(st, bank, x.t, "required-typed", rnd); if (it) return { item: it, ph: "t" }; }
  if (fr.length) throw new PlacementCoverageError(fr.map((topic) => topic.t));
  // Лимит выключает добор заданий, но не прерывает проверку тем уровня и назначенные перепроверки.
  const canExtend = st.core.filter((x) => !x.ph?.startsWith("v")).length < V6.CAP;
  // 3. каждая группа уровня — минимум 3 задания: тема группы, где ответов меньше всего; лучше сложное
  const gCount = (gid: string) => st.core.filter((y) => { const it = gItem(st, y.id); return isGram(it) && it!.level === PL_LEVELS[D] && it!.group === gid && st.answers[y.id] && y.ph !== "g"; }).length;
  const thin = canExtend ? shuffle(groupsOf(bank, D).filter((g) => gCount(g.id) < PER_GROUP), rnd) : [];
  for (const g of [...thin.filter((x) => x.id !== last.group), ...thin.filter((x) => x.id === last.group)]) {
    const ts = [...g.topics].sort((a, b) => topicAnswers(st, a).length - topicAnswers(st, b).length);
    for (const t of ts) { const it = topicPick(st, bank, t, "hard", rnd); if (it) return { item: it, ph: "t" }; }
  }
  // 4. пробелы базы уровнем ниже: ошибки лесенки на уровне ниже и темы-основы тем, которые не даются
  if (canExtend && D > 0 && st.bt === undefined) {
    const below = new Set(bank.core.filter((x) => isGram(x) && PL_LEVELS.indexOf(x.level) < D).map((x) => x.topic_id));
    const ladErr = (st.ld ?? []).filter((s) => s.L < D).flatMap((s) => s.ids).filter((id) => st.answers[id] && !st.answers[id].ok).map((id) => gItem(st, id)!.topic_id);
    const weak = tops.filter((x) => { const v = verdictOf(topicScore(topicAnswers(st, x.t))); return v === "gap" || v === "part"; }).flatMap((x) => bank.prereq?.[x.t] ?? []).filter((t) => below.has(t));
    st.bt = [...new Set([...ladErr, ...weak])].slice(0, V6.BASE_T);
  }
  for (const t of canExtend ? st.bt ?? [] : []) {
    const asked = st.core.filter((y) => y.ph === "g" && gItem(st, y.id)?.topic_id === t).length;
    if (asked >= V6.BASE_Q || t === last.topic) continue;
    const it = topicPick(st, bank, t, asked === 0 ? "typed" : "fix", rnd);
    if (it) return { item: it, ph: "g" };
  }
  // 5. контрольные, которые ещё «не созрели» (5 заданий не прошло), — когда больше нечего спрашивать
  for (const x of ctrlTopics.sort((a, b) => a.last - b.last)) {
    const it = topicPick(st, bank, x.t, x.ctrl === 0 ? "fix" : "typed", rnd);
    if (it) return { item: it, ph: "c" };
  }
  return null;
}

/** Итог грамматики v6: уровень — найденный лесенкой; «плюс» — уровень выше в лесенке почти сдан и сложные задания уровня даются;
 *  если на проверке тем уровня ответов меньше половины — ступень ниже (лесенка переоценила). */
function resultV6(st: PState, bank: Bank) {
  void bank;
  if (st.diag === undefined) return 0;
  const D = st.diag, b = BASE[PL_LEVELS[D]];
  const at = stat(st, (it, x) => isGram(it) && it.level === PL_LEVELS[D] && (x.ph === "t" || x.ph === "q" || x.ph === "c"));
  if (at.n >= 8 && at.c / at.n < 0.5) return Math.max(0, b - 1);
  if (D === 4) return 8;
  // «плюс»: уровень выше в лесенке (вес 0,6) и сложные задания найденного уровня (вес 0,4) — подобрано на симуляции
  const up = ladderLevel(st, D + 1);
  const hard = stat(st, (it, x) => isGram(it) && it.level === PL_LEVELS[D] && it.band > 1 && (x.ph === "t" || x.ph === "q" || x.ph === "c"));
  const h = hard.n >= 3 ? hard.c / hard.n : up.p;
  return up.series.length && 0.6 * up.p + 0.4 * h >= V6.PLUS ? b + 1 : b;
}

/** Сколько примерно осталось — для полоски прогресса. */
function remainingV6(st: PState, bank: Bank) {
  if (st.diag === undefined) {
    const L = st.ld?.[st.ld.length - 1]?.L ?? st.start ?? 1;
    return 12 + topicsAt(bank, Math.min(4, L + 1)).length * 1.6;
  }
  const tops = st.diagTopics ?? topicsAt(bank, st.diag);
  const untested = tops.filter((x) => !hasTypedTopic(st, x.t)).length;
  const ctrl = tops.reduce((a, x) => { const c = needCtrl(st, x.t); return a + (c.trigger ? Math.max(0, V6.CTRL - c.ctrl) : 0); }, 0);
  return untested + ctrl + 3;
}

/** Сводка v6 для разбора: лесенка по уровням, итог по каждой теме, пробелы базы, уверенность. */
export type V6Topic = { id: string; name: string; nameEn: string; level: PLevel; group: string; groupName: string; n: number; c: number; score: number | null; verdict: "own" | "part" | "gap" | null; sureWrong: boolean; slow: boolean; fix: boolean | null; typed: number; checks: { fix: number; typed: number; choice: number }; roots: string[] };
export type V6LadderSample = {
  level: PLevel;
  checked: { id: string; name: string; nameEn: string; c: number; n: number }[];
  unchecked: { name: string; nameEn: string }[] | null;
};
export class PlacementCoverageError extends Error {
  constructor(ids: string[]) {
    super(`Placement grammar bank is missing unused tasks for: ${ids.join(", ")}`);
  }
}
export type V6Summary = {
  ladder: { level: PLevel; series: { c: number; n: number; typed: number }[]; p: number; verdict: "up" | "down" | null }[];
  found: PLevel | null; topics: V6Topic[]; base: V6Topic[]; coverageKnown: boolean;
  samples: V6LadderSample[];
  conf: { sureRight: number; unsureRight: number; sureWrong: number; unsureWrong: number };
};
export function summarizeV6(st: PState, bank: Bank): V6Summary {
  const order: number[] = [];
  for (const s of st.ld ?? []) if (order[order.length - 1] !== s.L) order.push(s.L);
  const ladder = [...new Set(order)].map((L) => ({ level: PL_LEVELS[L], ...ladderLevel(st, L), verdict: st.lv?.[L] ?? null })).map(({ level, series, p, verdict }) => ({ level, series, p, verdict }));
  const gName = new Map(bank.groups.map((g) => [g.id, g.name_ru]));
  const byTopic = new Map(bank.core.map((x) => [x.topic_id, x]));
  const topic = (t: string, gid: string, level?: PLevel): V6Topic => {
    const xs = topicAnswers(st, t);
    const sc = topicScore(xs);
    const okx = xs.filter((x) => x.a.ok);
    const slow = okx.length >= 1 && okx.filter((x) => (x.a.ms ?? 0) > (typedIt(x.it) ? V6.SLOW_T : V6.SLOW_C)).length * 2 > okx.length;
    const fx = xs.find((x) => x.it.type === "fix");
    const first = xs[0]?.it;
    const item = first ?? byTopic.get(t);
    const checks = { fix: 0, typed: 0, choice: 0 };
    for (const x of xs) if (x.ph === "c") checks[x.it.type === "fix" ? "fix" : typedIt(x.it) ? "typed" : "choice"]++;
    return { id: t, name: item?.topic_ru ?? t, nameEn: item?.topic_en ?? t, level: first?.level ?? level ?? item?.level ?? "A1", group: gid, groupName: gName.get(gid) ?? "", n: xs.length, c: okx.length, score: sc, verdict: verdictOf(sc), sureWrong: xs.some((x) => !x.a.ok && x.a.cf === 1), slow, fix: fx ? !!fx.a.ok : null, typed: xs.filter((x) => typedIt(x.it)).length, checks, roots: [] };
  };
  const D = st.diag;
  const found = D === undefined ? null : PL_LEVELS[D];
  const samples: V6LadderSample[] = [...new Set(order)].filter((L) => L !== D).flatMap((L) => {
    const checked = new Map<string, V6LadderSample["checked"][number]>();
    for (const question of st.core) {
      const item = gItem(st, question.id), answer = st.answers[question.id];
      if (question.ph !== "q" || item?.level !== PL_LEVELS[L] || item.skill !== "grammar" || !answer) continue;
      const row = checked.get(item.topic_id) ?? { id: item.topic_id, name: item.topic_ru, nameEn: item.topic_en, c: 0, n: 0 };
      row.n++;
      if (answer.ok) row.c++;
      checked.set(item.topic_id, row);
    }
    if (!checked.size) return [];
    const unchecked = st.ladderTopicIds?.[L]?.filter((id) => !checked.has(id)).map((id) => {
      const item = byTopic.get(id);
      return { name: item?.topic_ru ?? id, nameEn: item?.topic_en ?? id };
    }) ?? null;
    return [{ level: PL_LEVELS[L], checked: [...checked.values()], unchecked }];
  });
  const diagnostic = new Map((st.diagTopics ?? (D === undefined ? [] : topicsAt(bank, D))).map((x) => [x.t, x.g]));
  // Перенос темы между уровнями не должен удалять её из отчёта о пройденном тесте.
  if (D !== undefined) {
    for (const question of st.core) {
      const item = gItem(st, question.id);
      if (item?.skill === "grammar" && item.level === PL_LEVELS[D] && question.ph !== "g" && question.ph !== "z" && !diagnostic.has(item.topic_id)) {
        diagnostic.set(item.topic_id, item.group ?? "");
      }
    }
  }
  const topics = [...diagnostic].map(([id, group]) => topic(id, group, found ?? undefined)).filter((x) => x.n || st.diagTopics);
  const gOf = new Map(bank.groups.flatMap((g) => g.topics.map((t) => [t, g.id] as const)));
  const base = (st.bt ?? []).map((t) => topic(t, gOf.get(t) ?? "")).filter((x) => x.n);
  // корень: тема-основа (уровнем ниже) тоже не даётся
  const weakBase = new Set(base.filter((x) => x.verdict === "gap" || x.verdict === "part").map((x) => x.id));
  for (const x of topics) if (x.verdict === "gap" || x.verdict === "part") x.roots = (bank.prereq?.[x.id] ?? []).filter((t) => weakBase.has(t)).map((t) => byTopic.get(t)?.topic_ru ?? t);
  const conf = { sureRight: 0, unsureRight: 0, sureWrong: 0, unsureWrong: 0 };
  for (const x of st.core) { const a = st.answers[x.id]; if (!a || a.cf === undefined) continue; if (a.ok) a.cf ? conf.sureRight++ : conf.unsureRight++; else a.cf ? conf.sureWrong++ : conf.unsureWrong++; }
  return { ladder, found, topics, base, coverageKnown: !!st.diagTopics, samples, conf };
}

/** «Найди и исправь» из заданий с вариантами: в предложение подставлен неверный вариант; span — его слова. */
export type FixSpec = { from: string; wrong: number; accept: string[]; instruction_en?: string };

export function buildFix(core: CoreItem[], spec: FixSpec[]): CoreItem[] {
  const by = new Map(core.map((x) => [x.id, x]));
  const out: CoreItem[] = [];
  for (const s of spec) {
    const x = by.get(s.from);
    if (!x || x.type !== "mcq" || !x.options?.[s.wrong] || x.q.split("___").length !== 2) continue;
    const [pre, post] = x.q.split("___");
    let wrong = x.options[s.wrong];
    if (!pre.trim()) wrong = wrong.charAt(0).toUpperCase() + wrong.slice(1);
    const start = pre.trim() ? pre.trim().split(/\s+/).length : 0;
    const q = `${pre}${wrong}${post}`.replace(/\s+/g, " ").trim();
    const item: CoreItem = { ...x, id: `F-${x.id}`, type: "fix", q, options: undefined, answer: undefined, wrong, span: [start, start + wrong.split(/\s+/).length - 1], accept: s.accept, instruction_en: s.instruction_en };
    out.push({ ...item, accept: acceptedFixCorrections(item) });
  }
  return out;
}
