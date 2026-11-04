// Справочник маршрутов: уровни CEFR, типы маршрутов, цели, содержание уровней.
// Используется на сервере (черновик маршрута без ИИ, заглушка ИИ) и в интерфейсе.

export type L2 = [string, string]; // [en, ru]
export type Stage = {
  lvl: string; title: L2 | string; hours: number;
  grammar: (L2 | string)[]; vocabulary: (L2 | string)[]; skills: (L2 | string)[]; feel?: (L2 | string)[];
  passed?: { score: number; at: string } | null;
};
export const txt = (x: L2 | string, lang: "ru" | "en") => (typeof x === "string" ? x : lang === "en" ? x[0] : x[1]);

export const LEVELS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1", "C1+", "C2"] as const;
/** Примерные учебные часы до уровня (с нуля) — по рекомендациям Cambridge / CEFR. */
const HOURS: Record<string, number> = { A1: 90, "A1+": 140, A2: 190, "A2+": 270, B1: 360, "B1+": 460, B2: 560, "B2+": 660, C1: 760, "C1+": 880, C2: 1000 };
export const hoursTo = (lvl: string) => HOURS[lvl] ?? 0;
export const levelIdx = (lvl?: string | null) => Math.max(0, LEVELS.indexOf((lvl ?? "A1").replace("−", "-").replace(/-$/, "") as (typeof LEVELS)[number]));

export const ROUTE_TYPES: Record<string, { name: L2; goals: string[]; exam?: boolean }> = {
  ge: { name: ["General English", "General English"], goals: ["A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1", "C1+", "C2"] },
  lvx: { name: ["Level up + exam", "Уровень + экзамен"], goals: ["B2 + IELTS 6.5", "B2 + B2 First", "C1 + IELTS 7.5", "C1 + C1 Advanced"] },
  ielts: { name: ["IELTS", "IELTS"], goals: ["IELTS 6.0", "IELTS 6.5", "IELTS 7.0", "IELTS 7.5", "IELTS 8.0"], exam: true },
  ege: { name: ["Unified State Exam", "ЕГЭ"], goals: ["ЕГЭ 70+", "ЕГЭ 80+", "ЕГЭ 90+"], exam: true },
  oge: { name: ["OGE", "ОГЭ"], goals: ["ОГЭ 50+", "ОГЭ 60+"], exam: true },
  toefl: { name: ["TOEFL", "TOEFL"], goals: ["TOEFL 80+", "TOEFL 90+", "TOEFL 100+"], exam: true },
  camb: { name: ["Cambridge exams", "Экзамены Cambridge"], goals: ["B2 First", "C1 Advanced", "C2 Proficiency"], exam: true },
  biz: { name: ["Business English", "Бизнес-английский"], goals: ["B2 для рабочих встреч", "Собеседование на английском", "C1 для переговоров"] },
  talk: { name: ["Speaking", "Разговорный английский"], goals: ["Говорить без страха", "Свободный разговор на любые темы"] },
  move: { name: ["Moving abroad", "Для переезда"], goals: ["Быт за границей", "Работа за границей"] },
};

/** Уровень CEFR, который стоит за целью: «IELTS 7.0» → C1, «ЕГЭ 90+» → B2+ … */
export function goalLevel(type: string, goal: string): string {
  if ((LEVELS as readonly string[]).includes(goal)) return goal;
  const m = goal.match(/\b([ABC][12]\+?)\b/); if (m) return m[1];
  const ielts = goal.match(/IELTS (\d\.\d)/); if (ielts) { const b = Number(ielts[1]); return b >= 8 ? "C1+" : b >= 7 ? "C1" : b >= 6.5 ? "B2+" : b >= 6 ? "B2" : "B1+"; }
  const pts = goal.match(/(\d+)\+/); const n = pts ? Number(pts[1]) : 0;
  if (type === "ege") return n >= 90 ? "B2+" : n >= 80 ? "B2" : "B1+";
  if (type === "oge") return n >= 60 ? "B1" : "A2+";
  if (type === "toefl") return n >= 100 ? "C1" : n >= 90 ? "B2+" : "B2";
  if (/C2/.test(goal)) return "C2";
  if (/C1|переговор/i.test(goal)) return "C1";
  if (/свободный|любые|работа за/i.test(goal)) return "B2";
  if (/B2|встреч|собеседован/i.test(goal)) return "B2";
  return "B1+";
}

// ───────── Содержание уровней (General English) ─────────
type Content = { title: L2; grammar: L2[]; vocabulary: L2[]; skills: L2[]; feel: L2[] };
export const CONTENT: Record<string, Content> = {
  A1: { title: ["First steps", "Первые шаги"], grammar: [["to be, have got, there is / are", "to be, have got, there is / are"], ["Present Simple: I work, he works", "Present Simple: I work, he works"]], vocabulary: [["Family, home, food, numbers, time", "Семья, дом, еда, числа, время"]], skills: [["I can introduce myself and ask simple questions", "Могу представиться и задать простые вопросы"]], feel: [["You understand slow, clear phrases about yourself", "Понимаешь медленные чёткие фразы о себе"]] },
  "A1+": { title: ["Confident basics", "Уверенная база"], grammar: [["Present Continuous, can / can’t", "Present Continuous, can / can’t"], ["Questions with do / does", "Вопросы с do / does"]], vocabulary: [["Daily routine, shopping, city", "Распорядок дня, покупки, город"]], skills: [["I can talk about my day", "Могу рассказать о своём дне"]], feel: [["You can manage a simple shop or café conversation", "Справляешься с простым разговором в магазине или кафе"]] },
  A2: { title: ["Everyday English", "Английский на каждый день"], grammar: [["Past Simple: regular and irregular verbs", "Past Simple: правильные и неправильные глаголы"], ["Comparatives and superlatives", "Степени сравнения"]], vocabulary: [["Travel, health, work, free time", "Путешествия, здоровье, работа, свободное время"]], skills: [["I can describe past events and plans", "Могу описать прошлые события и планы"], ["I can write a short message", "Могу написать короткое сообщение"]], feel: [["You get by when travelling", "Справляешься в поездках"]] },
  "A2+": { title: ["A2+: towards B1", "A2+: на пути к B1"], grammar: [["Future: will and going to", "Будущее: will и going to"], ["Present Perfect: experience", "Present Perfect: опыт"]], vocabulary: [["About 1 500 most common words", "Около 1 500 самых частотных слов"]], skills: [["I can explain what I like and why", "Могу объяснить, что нравится и почему"]], feel: [["You follow simple films with subtitles", "Понимаешь простые фильмы с субтитрами"]] },
  B1: { title: ["Solid B1", "Крепкий B1"], grammar: [["Present Perfect vs Past Simple", "Present Perfect и Past Simple"], ["used to, modals: must, have to, should", "used to, модальные: must, have to, should"], ["First conditional", "Первое условное"]], vocabulary: [["Work, money, technology, emotions", "Работа, деньги, технологии, эмоции"], ["Phrasal verbs, linking words", "Фразовые глаголы, слова-связки"]], skills: [["I can tell a story with details", "Могу рассказать историю с деталями"], ["I follow a podcast on a familiar topic", "Понимаю подкаст на знакомую тему"]], feel: [["You talk about familiar topics without much preparation", "Говоришь на знакомые темы почти без подготовки"], ["You can write a clear email", "Пишешь понятное письмо"]] },
  "B1+": { title: ["B1+: freer in conversation", "B1+: свободнее в разговоре"], grammar: [["Second conditional, passive: Present and Past", "Второе условное, пассив: Present и Past"], ["Relative clauses, articles in depth", "Придаточные с who / which / that, артикли"]], vocabulary: [["Opinions, agreeing and disagreeing", "Мнения, согласие и несогласие"], ["Meetings and teamwork", "Встречи и командная работа"]], skills: [["I can give and defend my opinion", "Могу высказать и отстоять мнение"], ["I can take part in a meeting", "Могу участвовать во встрече"]], feel: [["You join discussions and keep the conversation going", "Участвуешь в обсуждениях и поддерживаешь разговор"]] },
  B2: { title: ["Confident B2", "Уверенный B2"], grammar: [["Reported speech, passive in all tenses", "Косвенная речь, пассив во всех временах"], ["Present Perfect Continuous, modals of deduction", "Present Perfect Continuous, модальные предположения"]], vocabulary: [["Presentations and job interviews", "Презентации и собеседования"], ["Word formation, collocations", "Словообразование, сочетаемость"]], skills: [["I can present an idea and answer questions", "Могу презентовать идею и ответить на вопросы"], ["I understand native speakers at normal speed", "Понимаю носителей в обычном темпе"]], feel: [["You speak fluently on most topics", "Свободно говоришь на большинство тем"], ["You write an argumentative essay", "Пишешь эссе с аргументами"]] },
  "B2+": { title: ["B2+: fluent and accurate", "B2+: свободно и точно"], grammar: [["Mixed conditionals, wish / if only", "Смешанные условные, wish / if only"], ["Advanced linking and emphasis", "Сложные связки и усиление"]], vocabulary: [["B2 topic vocabulary, common idioms", "Тематическая лексика B2, частотные идиомы"]], skills: [["I keep a spontaneous conversation going", "Поддерживаю спонтанный разговор"]], feel: [["You watch series without subtitles most of the time", "Смотришь сериалы без субтитров в большинстве случаев"]] },
  C1: { title: ["Advanced C1", "Продвинутый C1"], grammar: [["Inversion, cleft sentences, participle clauses", "Инверсия, выделение, причастные обороты"]], vocabulary: [["Precise vocabulary for your field, register", "Точная лексика своей сферы, регистр"]], skills: [["I speak naturally in almost any situation", "Говорю естественно почти в любой ситуации"], ["I write well-structured texts for different readers", "Пишу хорошо структурированные тексты для разных читателей"]], feel: [["You work and study in English comfortably", "Комфортно работаешь и учишься на английском"]] },
  "C1+": { title: ["C1+: nuance", "C1+: нюансы"], grammar: [["Accuracy in complex structures", "Точность в сложных конструкциях"]], vocabulary: [["Idiomatic and less common vocabulary", "Идиоматичная и менее частотная лексика"]], skills: [["I negotiate and argue a point convincingly", "Убедительно веду переговоры и спор"]], feel: [["You catch humour and implied meaning", "Улавливаешь юмор и подтекст"]] },
  C2: { title: ["Mastery C2", "Мастерство C2"], grammar: [["Full control of grammar for style", "Полный контроль грамматики ради стиля"]], vocabulary: [["Near-native range", "Словарный запас, близкий к носителю"]], skills: [["I express myself precisely on any topic", "Точно выражаю мысль на любую тему"]], feel: [["English feels like a second home", "Английский — почти второй родной"]] },
};

const EXAM: Record<string, (from: string, to: string) => { lvl: string; title: L2; grammar: L2[]; vocabulary: L2[]; skills: L2[] }[]> = {
  ielts: () => [
    { lvl: "5.5", title: ["Exam format, band 5.5 secure", "Формат экзамена, уверенные 5.5"], grammar: [["Complex sentences for Writing", "Сложные предложения для Writing"]], vocabulary: [["Academic word list, part 1", "Академическая лексика, часть 1"]], skills: [["I know every part of the exam", "Знаю все части экзамена"]] },
    { lvl: "6.0", title: ["Band 6.0", "Балл 6.0"], grammar: [["Describing trends and comparisons", "Описание трендов и сравнения"]], vocabulary: [["Academic word list, part 2", "Академическая лексика, часть 2"]], skills: [["I can describe a chart", "Могу описать график"]] },
    { lvl: "6.5", title: ["Band 6.5", "Балл 6.5"], grammar: [["Cohesion and range in essays", "Связность и разнообразие в эссе"]], vocabulary: [["Topic vocabulary for Speaking", "Тематическая лексика для Speaking"]], skills: [["I write a 250-word essay", "Пишу эссе на 250 слов"]] },
    { lvl: "7.0", title: ["Band 7.0 in mocks", "7.0 на пробниках"], grammar: [["Error review", "Работа над ошибками"]], vocabulary: [["Less common vocabulary", "Менее частотная лексика"]], skills: [["I reach 7.0 in mock exams", "Набираю 7.0 на пробниках"]] },
  ],
  ege: () => [
    { lvl: "60–70", title: ["Grammar and vocabulary section", "Раздел «Грамматика и лексика»"], grammar: [["Tenses in context, passive", "Времена в контексте, пассив"]], vocabulary: [["Word formation", "Словообразование"]], skills: [["I choose the right form", "Выбираю правильную форму"]] },
    { lvl: "70–80", title: ["Reading and listening", "Чтение и аудирование"], grammar: [["Linking words", "Слова-связки"]], vocabulary: [["Exam topics vocabulary", "Лексика экзаменационных тем"]], skills: [["I find the main idea fast", "Быстро нахожу главную мысль"]] },
    { lvl: "80–85", title: ["Writing: email and essay", "Письмо: e-mail и эссе"], grammar: [["Complex sentences", "Сложные предложения"]], vocabulary: [["Essay phrases", "Фразы для эссе"]], skills: [["I write a 200–250-word essay", "Пишу эссе на 200–250 слов"]] },
    { lvl: "90+", title: ["Speaking and full mocks", "Устная часть и пробники"], grammar: [["Error review", "Работа над ошибками"]], vocabulary: [["Describing photos", "Описание фото"]], skills: [["I score 90+ in mocks", "Набираю 90+ на пробниках"]] },
  ],
  oge: () => [
    { lvl: "45–50", title: ["Grammar base", "Грамматическая база"], grammar: [["Tenses and forms", "Времена и формы"]], vocabulary: [["Word formation", "Словообразование"]], skills: [["I complete the grammar part", "Выполняю грамматическую часть"]] },
    { lvl: "50–55", title: ["Reading and listening", "Чтение и аудирование"], grammar: [["Linking words", "Слова-связки"]], vocabulary: [["School topics", "Школьные темы"]], skills: [["I understand the main idea", "Понимаю основную мысль"]] },
    { lvl: "55–58", title: ["Personal letter", "Личное письмо"], grammar: [["Questions", "Вопросы"]], vocabulary: [["Letter phrases", "Фразы для письма"]], skills: [["I write a letter to a friend", "Пишу письмо другу"]] },
    { lvl: "60+", title: ["Speaking and mocks", "Устная часть и пробники"], grammar: [["Error review", "Работа над ошибками"]], vocabulary: [["Monologue phrases", "Фразы для монолога"]], skills: [["I score 60+ in mocks", "Набираю 60+ на пробниках"]] },
  ],
};

/** Черновик этапов по справочнику (без ИИ): от уровня «сейчас» до цели. */
export function templateStages(type: string, from: string, goal: string, units: { title: string }[] = []): Stage[] {
  const to = goalLevel(type, goal);
  const ex = EXAM[type];
  if (ex) {
    const list = ex(from, to);
    const total = Math.max(80, hoursTo(to) - hoursTo(from));
    return list.map((x) => ({ ...x, hours: Math.round(total / list.length / 5) * 5 || 30, feel: [] }));
  }
  let a = levelIdx(from), b = levelIdx(to);
  if (b <= a) b = Math.min(LEVELS.length - 1, a + 1);
  const out: Stage[] = [];
  for (let i = a; i <= b; i++) {
    const lvl = LEVELS[i];
    const prev = i === a ? (i === 0 ? 0 : hoursTo(lvl) - 30) : hoursTo(LEVELS[i - 1]);
    const h = i === a ? 30 : hoursTo(lvl) - prev; // первый этап — укрепить текущий уровень
    const c = CONTENT[lvl];
    out.push({ lvl, title: i === a ? [`Solid ${lvl} foundation`, `Крепкий фундамент ${lvl}`] : c.title, hours: Math.max(20, Math.round(h / 5) * 5), grammar: c.grammar, vocabulary: c.vocabulary, skills: c.skills, feel: c.feel });
  }
  if (units.length && out.length) out[0].vocabulary = [...out[0].vocabulary, [`Course units: ${units.slice(0, 3).map((u) => u.title).join(", ")}`, `Юниты курса: ${units.slice(0, 3).map((u) => u.title).join(", ")}`]];
  return out;
}

export function templateCriteria(type: string, goal: string): L2[] {
  const to = goalLevel(type, goal);
  const c = CONTENT[to] ?? CONTENT.B2;
  return [
    [`Final test: ${goal} — 75% or more in every skill`, `Итоговый тест: ${goal} — от 75% по каждому навыку`],
    ...c.skills,
    ...(ROUTE_TYPES[type]?.exam ? [["Two mock exams at the target score in a row", "Два пробных экзамена подряд на целевой балл"] as L2] : []),
  ];
}

// ───────── Навыки ─────────
export const SKILLS = ["grammar", "vocabulary", "reading", "listening", "writing", "speaking"] as const;
export type Skill = (typeof SKILLS)[number];
export const SKILL_NAME: Record<Skill, L2> = { grammar: ["Grammar", "Грамматика"], vocabulary: ["Vocabulary", "Лексика"], reading: ["Reading", "Чтение"], listening: ["Listening", "Аудирование"], writing: ["Writing", "Письмо"], speaking: ["Speaking", "Говорение"] };
export const SKILL_COLOR: Record<Skill, string> = { grammar: "#007AFF", vocabulary: "#FF9500", reading: "#34C759", listening: "#5AC8FA", writing: "#FF2D55", speaking: "#AF52DE" };

/** Короткий отзыв по навыку по проценту — код, без ИИ. */
export function skillNote(skill: Skill, v: number): L2 {
  const band = v >= 80 ? 2 : v >= 60 ? 1 : 0;
  const N: Record<Skill, [L2, L2, L2]> = {
    grammar: [["Basic tenses get mixed up — a focus for the next lessons.", "Базовые времена путаются — это фокус ближайших уроков."], ["Main tenses are fine; the more complex structures still need work.", "Основные времена в порядке, сложные конструкции ещё в работе."], ["Grammar is a strong point.", "Грамматика — сильная сторона."]],
    vocabulary: [["Not enough words for everyday topics yet.", "Пока не хватает слов для бытовых тем."], ["Good everyday vocabulary; work and abstract topics are thinner.", "Хорошая бытовая лексика, рабочие и абстрактные темы — слабее."], ["Wide vocabulary.", "Широкий словарный запас."]],
    reading: [["Short texts take a lot of effort.", "Короткие тексты даются с трудом."], ["Understands articles on familiar topics; longer texts are harder.", "Понимает статьи на знакомые темы, длинные тексты — сложнее."], ["Reads confidently.", "Уверенно читает."]],
    listening: [["Needs slow, clear speech.", "Нужна медленная чёткая речь."], ["Understands clear speech; normal speed is hard.", "Понимает чёткую речь, обычный темп — тяжело."], ["Understands speech at normal speed.", "Понимает речь в обычном темпе."]],
    writing: [["Short sentences with many mistakes.", "Короткие фразы, много ошибок."], ["Writes simple texts; few linking words.", "Пишет простые тексты, мало связок."], ["Writes clearly and accurately.", "Пишет понятно и точно."]],
    speaking: [["Short answers, long pauses.", "Короткие ответы, долгие паузы."], ["Speaks on familiar topics.", "Говорит на знакомые темы."], ["Speaks fluently.", "Говорит свободно."]],
  };
  return N[skill][band];
}
