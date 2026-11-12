// Конструктор отчёта по placement test: два варианта (ученик — подробный, родитель — простыми словами),
// русский или английский; английский подстраивается под уровень ученика (до B1 — простые фразы, с B2 — сложнее).
// Тексты — черновик: учитель правит любой блок, правки хранятся отдельно для каждого варианта и языка.

export type RVariant = "student" | "parent";
export type RLang = "ru" | "en";
export const R_BLOCKS = ["level", "skills", "strong", "work", "grammar", "writing", "answers", "plan", "comment"] as const;
export type RBlock = (typeof R_BLOCKS)[number];
/** Какие блоки — текст (их можно править), какие — таблицы из результатов. */
export const R_TEXT: RBlock[] = ["level", "strong", "work", "plan", "comment"];
/** Технические блоки — только в варианте для ученика. */
export const R_STUDENT_ONLY: RBlock[] = ["grammar", "writing", "answers"];

export type RSkill = "core" | "vocab" | "reading" | "listening" | "writing" | "speaking";
export const R_SKILLS: RSkill[] = ["core", "vocab", "reading", "listening", "writing", "speaking"];
export type RFamily = { id: string; name: string; c: number; n: number };
export type RInput = {
  name: string; teen: boolean; level: string | null; // итоговый подуровень (A1…C1, с «+») — утверждённый или оценка системы
  skills: Partial<Record<RSkill, string | null>>; families: RFamily[]; vweak: string[]; comment: string;
};
export type RCfg = { lang: RLang; on: Partial<Record<RBlock, boolean>>; texts: Record<string, string> }; // texts: «ru:level», «en:plan»…
export type RSaved = { student?: RCfg; parent?: RCfg; sent?: boolean; sentAt?: string };

const STEPS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1"];
const step = (s: string | null | undefined) => (s ? STEPS.indexOf(s) : -1);
const base = (s: string | null) => (s ? s.replace("+", "") : "A1");
const next = (s: string | null) => { const i = ["A1", "A2", "B1", "B2", "C1", "C2"].indexOf(base(s)); return ["A1", "A2", "B1", "B2", "C1", "C2"][Math.min(5, i + 1)]; };

export const R_TITLES: Record<RLang, Record<RBlock | "report" | "student" | "parent" | "date", string>> = {
  ru: { report: "Результаты placement test", student: "Для ученика", parent: "Для родителей", date: "Дата", level: "Итоговый уровень", skills: "Результаты по навыкам", strong: "Сильные стороны", work: "Над чем поработать", grammar: "Грамматика по разделам", writing: "Письмо", answers: "Разбор ответов", plan: "Рекомендации", comment: "Комментарий преподавателя" },
  en: { report: "Placement test results", student: "For the student", parent: "For parents", date: "Date", level: "Overall level", skills: "Results by skill", strong: "Strengths", work: "Areas to work on", grammar: "Grammar by topic", writing: "Writing", answers: "Answers", plan: "Recommendations", comment: "Teacher's comment" },
};
export const R_SKILL_NAME: Record<RLang, Record<RSkill, string>> = {
  ru: { core: "Грамматика", vocab: "Лексика", reading: "Чтение", listening: "Аудирование", writing: "Письмо", speaking: "Говорение" },
  en: { core: "Grammar", vocab: "Vocabulary", reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" },
};
const FAM_EN: Record<string, string> = {
  present: "present tenses", past: "past tenses", future: "future forms", modals: "modal verbs", conditionals: "conditionals and unreal situations",
  passive: "the passive", reported: "reported speech", comparison: "comparatives, adjectives and adverbs", articles: "articles, nouns and quantity",
  pronouns: "pronouns, prepositions and questions", clauses: "complex sentences and linking words", patterns: "verb patterns", emphasis: "inversion and emphasis",
};
const famName = (f: RFamily, lang: RLang) => (lang === "en" ? FAM_EN[f.id] ?? f.name : f.name.toLowerCase());

// Что умеет человек на этом уровне (по описаниям CEFR)
const CAN: Record<"ru" | "enS" | "enL", Record<string, string>> = {
  ru: {
    A1: "Понимает и использует простые знакомые фразы, может рассказать о себе, семье и своих вещах, задать простые вопросы и ответить на них, если собеседник говорит медленно.",
    A2: "Понимает фразы на привычные темы — семья, покупки, учёба, отдых, — может простыми предложениями рассказать о прошлых событиях и планах и справляется с короткими бытовыми разговорами.",
    B1: "Понимает главное в ясной речи на знакомые темы, может рассказать о событиях, впечатлениях и планах, объяснить своё мнение и справиться с большинством ситуаций в поездке.",
    B2: "Понимает основные идеи сложных текстов, говорит достаточно свободно, чтобы общаться с носителями языка без особых трудностей, может подробно высказываться на разные темы и аргументировать свою точку зрения.",
    C1: "Понимает длинные сложные тексты и скрытый смысл, говорит бегло и спонтанно, гибко использует язык для учёбы, работы и общения.",
  },
  enS: {
    A1: "You can understand and use simple everyday phrases. You can talk about yourself, your family and your things, and ask and answer simple questions.",
    A2: "You can understand sentences about everyday topics like family, shopping, school and free time. You can talk about the past and your plans in simple sentences.",
    B1: "You can understand the main ideas when people speak clearly about familiar topics. You can describe events and plans and give your opinion.",
    B2: "You can understand the main ideas of complex texts and talk with native speakers quite easily. You can give clear, detailed opinions on many topics.",
    C1: "You can understand long, difficult texts and what is meant between the lines. You can express yourself fluently and naturally.",
  },
  enL: {
    A1: "At this level, a learner can understand and use familiar everyday expressions and very basic phrases, introduce themselves and handle simple exchanges, provided the other person speaks slowly and clearly.",
    A2: "At this level, a learner can understand frequently used expressions related to everyday life, communicate in simple routine situations and describe their background, past experiences and immediate plans.",
    B1: "At this level, a learner can understand the main points of clear speech on familiar matters, deal with most situations while travelling, and produce connected text on topics of personal interest, briefly justifying opinions and plans.",
    B2: "At this level, a learner can understand the main ideas of complex texts, interact with a degree of fluency and spontaneity that makes regular conversation with native speakers quite possible, and produce clear, detailed text on a wide range of subjects.",
    C1: "At this level, a learner can understand a wide range of demanding, longer texts, recognise implicit meaning, and express ideas fluently and spontaneously without much obvious searching for expressions.",
  },
};
// Навыки простыми словами для родителей
const PLAIN: Record<RLang, Record<RSkill, [string, string]>> = { // [сильная сторона, над чем поработать]
  ru: {
    core: ["уверенно строит предложения, грамматическая база крепкая", "грамматика — правильное построение предложений"],
    vocab: ["хороший для своего уровня словарный запас", "словарный запас"],
    reading: ["хорошо понимает прочитанные тексты", "понимание текстов"],
    listening: ["хорошо понимает английскую речь на слух", "понимание речи на слух"],
    writing: ["связно и понятно пишет", "письменная речь"],
    speaking: ["уверенно говорит и отвечает на вопросы", "устная речь, уверенность в разговоре"],
  },
  en: {
    core: ["builds sentences confidently; the grammar foundation is solid", "grammar — building sentences correctly"],
    vocab: ["has a good vocabulary for this level", "vocabulary"],
    reading: ["understands written texts well", "reading comprehension"],
    listening: ["understands spoken English well", "listening comprehension"],
    writing: ["writes clearly and coherently", "writing"],
    speaking: ["speaks confidently and answers questions well", "speaking and confidence in conversation"],
  },
};

/** Черновики текстовых блоков для варианта и языка. */
export function draftTexts(x: RInput, v: RVariant, lang: RLang): Record<string, string> {
  const L = x.level ?? "—", B = base(x.level), ov = step(x.level);
  const enL = lang === "en" && (v === "parent" || step(x.level) >= 6); // родителям и ученикам с B2 — полноценный английский
  const can = lang === "ru" ? CAN.ru[B] : enL ? CAN.enL[B] : CAN.enS[B];
  const sk = R_SKILLS.map((k) => ({ k, s: step(x.skills[k] ?? null) })).filter((y) => y.s >= 0);
  const strongSk = sk.filter((y) => ov >= 0 && y.s >= ov).map((y) => y.k);
  const weakSk = sk.filter((y) => ov >= 0 && y.s <= ov - 2).map((y) => y.k);
  const famStrong = x.families.filter((f) => f.n >= 3 && f.c / f.n >= 0.85);
  const famWeak = x.families.filter((f) => f.n >= 2 && f.c / f.n < 0.5);
  const ru = lang === "ru";
  const list = (xs: string[]) => xs.map((s) => `• ${s}`).join("\n");
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const nm = x.name || (ru ? "Ученик" : "The student");

  let level: string, strong: string, work: string, plan: string;
  if (v === "student") {
    level = ru ? `${x.teen ? "Твой" : "Ваш"} уровень — ${L} по шкале CEFR. ${can}` : `${enL ? "Your overall level is" : "Your level is"} ${L}. ${can}`;
    const s1 = [
      ...strongSk.map((k) => `${R_SKILL_NAME[lang][k]}: ${x.skills[k]}`),
      ...(famStrong.length ? [(ru ? "Грамматика: " : "Grammar: ") + famStrong.slice(0, 4).map((f) => famName(f, lang)).join(", ")] : []),
    ];
    strong = s1.length ? list(s1) : weakSk.length ? (ru ? "Допишите, что получилось лучше всего." : "Add what went best.") : ru ? `Результаты ровные по всем навыкам — хорошая база для уровня ${L}.` : `Your results are even across all skills — a good base for ${L}.`;
    const w1 = [
      ...weakSk.map((k) => `${R_SKILL_NAME[lang][k]}: ${x.skills[k]}`),
      ...(famWeak.length ? [(ru ? "Грамматика: " : "Grammar: ") + famWeak.slice(0, 4).map((f) => famName(f, lang)).join(", ")] : []),
      ...(ru && x.vweak.length ? ["Лексика: " + x.vweak.slice(0, 4).join(", ").toLowerCase()] : []),
    ];
    work = w1.length ? list(w1) : ru ? `Явных пробелов тест не выявил — можно двигаться дальше по программе уровня ${L}.` : `The test found no clear gaps — ${enL ? "you can move on with the" : "you can go on with the"} ${L} programme.`;
    const focus = [...weakSk.map((k) => R_SKILL_NAME[lang][k].toLowerCase()), ...famWeak.slice(0, 2).map((f) => famName(f, lang))];
    plan = ru
      ? `Ближайшая цель — уверенный ${next(x.level)}. ${focus.length ? `На занятиях сделаем упор на: ${focus.join(", ")}.` : "На занятиях будем развивать все навыки равномерно."} Все ошибки из теста разберём вместе на уроке.`
      : enL
        ? `The next goal is a confident ${next(x.level)}. ${focus.length ? `In lessons we will focus on ${focus.join(", ")}.` : "In lessons we will develop all skills evenly."} We will go through all the mistakes from the test together.`
        : `Your next goal is ${next(x.level)}. ${focus.length ? `In our lessons we will work on ${focus.join(", ")}.` : "In our lessons we will work on all skills."} We will look at your mistakes together.`;
  } else {
    level = ru
      ? `${nm} сейчас на уровне ${L} по международной шкале CEFR (от A1 — начальный до C2 — свободное владение). Что это значит на практике: ${can.charAt(0).toLowerCase() + can.slice(1)}`
      : `${nm}'s current level is ${L} on the international CEFR scale (from A1, beginner, to C2, proficient). ${can}`;
    const s1 = strongSk.map((k) => PLAIN[lang][k][0]);
    strong = s1.length ? list(s1.map(cap)) : weakSk.length ? (ru ? "Допишите, что получилось лучше всего." : "Add what went best.") : ru ? "Результаты ровные по всем навыкам — хорошая основа для дальнейших занятий." : "The results are even across all skills, which is a good foundation for further study.";
    const w1 = [...weakSk.map((k) => PLAIN[lang][k][1]), ...(famWeak.length ? [(ru ? "отдельные темы грамматики: " : "some grammar topics: ") + famWeak.slice(0, 3).map((f) => famName(f, lang)).join(", ")] : [])];
    work = w1.length ? list(w1.map(cap)) : ru ? "Серьёзных пробелов тест не выявил." : "The test did not reveal any serious gaps.";
    plan = ru
      ? `Рекомендуем регулярные занятия 2–3 раза в неделю и немного английского каждый день: сериалы, книги или игры на английском. Ближайшая цель — уровень ${next(x.level)}; при регулярных занятиях переход на следующий уровень обычно занимает от нескольких месяцев до полугода — точный срок зависит от ученика.`
      : `We recommend regular lessons two or three times a week, plus a little English every day — series, books or games in English. The next goal is ${next(x.level)}; with regular study, moving up a level usually takes from a few months to half a year, depending on the student.`;
  }
  return { level, strong, work, plan, comment: x.comment };
}

/** Блоки по умолчанию: родителю — без технических таблиц. */
export const defaultOn = (v: RVariant): Partial<Record<RBlock, boolean>> =>
  Object.fromEntries(R_BLOCKS.map((b) => [b, v === "student" || !R_STUDENT_ONLY.includes(b)]));

/** Итоговая конфигурация: сохранённое поверх черновика. */
export function resolve(x: RInput, v: RVariant, saved?: RCfg): { lang: RLang; on: Record<RBlock, boolean>; texts: Record<string, string> } {
  const lang: RLang = saved?.lang === "en" ? "en" : "ru";
  const on = { ...defaultOn(v), ...(saved?.on ?? {}) } as Record<RBlock, boolean>;
  if (v === "parent") for (const b of R_STUDENT_ONLY) on[b] = false;
  const d = draftTexts(x, v, lang);
  const texts = Object.fromEntries(R_TEXT.map((b) => [b, saved?.texts?.[`${lang}:${b}`] ?? d[b] ?? ""]));
  return { lang, on, texts };
}
