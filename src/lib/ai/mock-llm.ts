// Заглушка моделей для разработки и автотестов (AI_PROVIDER=mock): без сети, ответы по образцу настоящих.
import type { ChatRes, LlmMsg } from "./providers";

const FIXES: [RegExp, string, string, string][] = [
  [/\bwe was\b/i, "we were", "grammar", "После we — were (Past Simple от be во множественном числе)."],
  [/\bI go to\b/, "I went to", "grammar", "Прошлое (last year) — Past Simple: go → went."],
  [/\bexited\b/i, "excited", "spelling", "excited — взволнованный; exited — «вышел»."],
  [/\bbecouse\b/i, "because", "spelling", "Правильно: because."],
  [/\brealy\b/i, "really", "spelling", "Правильно: really (две l)."],
  [/\bmany museum\b/i, "many museums", "grammar", "После many — множественное число: museums."],
  [/\bweather were\b/i, "weather was", "grammar", "weather — неисчисляемое, глагол в единственном числе: was."],
  [/\bdidn't understood\b/i, "didn't understand", "grammar", "После didn't — начальная форма глагола."],
  [/\bfirst travel\b/i, "first trip", "collocation", "Поездка — trip; travel обычно глагол или неисчисляемое."],
];

const textOf = (u: string) => { const a = u.indexOf("<<<STUDENT_TEXT\n"), b = u.indexOf("\nSTUDENT_TEXT>>>"); return a >= 0 && b > a ? u.slice(a + 16, b) : ""; };

function check(user: string) {
  const text = textOf(user);
  const edits = [];
  for (const [re, to, category, why] of FIXES) {
    const m = re.exec(text);
    if (!m) continue;
    const corrected = m[0][0] === m[0][0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
    edits.push({ id: edits.length + 1, type: "error", original: m[0], start: m.index, end: m.index + m[0].length, corrected, category, severity: "medium", explanation: why });
  }
  // правка, которой нет в тексте, — платформа должна её отбросить
  edits.push({ id: edits.length + 1, type: "error", original: "this fragment is not in the text", start: 0, end: 10, corrected: "x", category: "grammar", severity: "low", explanation: "—" });
  return {
    edits, corrected_text: "",
    summary: {
      strengths: ["Понятная структура: вступление, примеры, вывод."], main_issues: edits.length > 2 ? ["Past Simple: формы глаголов в прошлом"] : [],
      next_steps: ["Повторить неправильные глаголы (go — went, be — was/were)."], task_achievement: "Задание выполнено.", estimated_level: "B1",
      comment_to_student: "Хорошая работа: мысль понятна, текст читается легко. Главное — следите за прошедшим временем.",
    },
    scores: null,
  };
}

function route(user: string) {
  const from = /"from_level"\s*:\s*"([^"]+)"/.exec(user)?.[1] ?? /"overall_level"\s*:\s*"([^"]+)"/.exec(user)?.[1] ?? "B1";
  const goal = /"goal_level"\s*:\s*"([^"]+)"/.exec(user)?.[1] ?? "B2";
  const req = /"teacher_request"\s*:\s*"([^"]*)"/.exec(user)?.[1] ?? "";
  const L = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1", "C1+", "C2"];
  const mid = L[Math.min(L.length - 1, L.indexOf(from) + 1)] ?? `${from}+`;
  const gapPts = [
    { title: "Articles with abstract nouns and geographical names", level: mid, hours: 6, hours_why: "4 ошибки из 5 в тесте → 6 ч", why: "ошибки в тесте: артикли", focus: "лексика путешествий и стран" },
    { title: "Inversion after negative adverbials", level: mid, hours: 5, why: "инверсия не используется", focus: "формальная речь, презентации" },
    { title: "Mixed conditionals", level: mid, hours: 5, why: "ошибки в смешанных условных", focus: "обсуждение решений и сожалений" },
  ];
  if (/говорени|speaking/i.test(req)) gapPts.push({ title: "Speaking: negotiation phrases with modal verbs", level: mid, hours: 6, why: "по просьбе учителя", focus: "переговоры" });
  return {
    start: { overall_level: from, skills: { grammar: from, vocabulary: from, reading: from, listening: from, writing: from, speaking: from }, gaps: ["артикли и продвинутая грамматика"] },
    goal: { level: goal, exam: null, explanation: "Уверенное общение на рабочие темы, сложные конструкции без ошибок.", criteria: ["Проводит 30-минутные переговоры без упрощения грамматики", "Пишет деловое письмо без ошибок в артиклях", "Понимает подкаст C1 с первого прослушивания"] },
    share: { gaps: true, self_study: true, criteria: true, message: true },
    weekly_hours: 4.5,
    segments: [
      { title: `${from} → ${mid}`, kind: "gaps", summary: "Закрываем пробелы из теста.", points: gapPts, units: [], can_do_after: ["пишет и говорит без системных ошибок в артиклях"], checkpoint: { tests: ["grammar"], pass_rule: "от 80% по темам участка" } },
      ...(mid !== goal ? [{ title: `${mid} → ${goal}`, kind: "level", summary: "Новый уровень.", points: [
        { title: "Cleft sentences for emphasis", level: goal, hours: 10, why: "грамматика уровня", focus: "презентации" },
        { title: "Advanced passive structures", level: goal, hours: 10, why: "грамматика уровня", focus: "статьи и отчёты" },
        { title: "Discourse markers and hedging", level: goal, hours: 12, why: "письмо и говорение", focus: "аргументация" },
      ], units: [], can_do_after: ["аргументирует позицию в переговорах"], checkpoint: { tests: ["speaking", "writing"], pass_rule: "от 75%" } }] : []),
    ],
    deadline_check: null, risks: ["Мало самостоятельной практики — прогноз сдвинется."],
    pace_options: [{ lessons_per_week: 2, daily_minutes: 20, forecast_weeks: 33 }],
    teacher_summary: ["**Сначала** быстро закрываем пробелы из теста", "**Затем** новый уровень", "**Говорение** — каждый урок"],
    student_message: "Ты уже близко к цели: сначала уберём слабые места, потом — новый уровень.",
    self_study: { items: [
      { skill: "listening", activity: "Подкасты о психологии", how: "Слушать эпизод, выписывать 5 новых выражений", times_per_week: 3, minutes: 20, search: "psychology podcast", why: "аудирование и лексика по интересам" },
      { skill: "speaking", activity: "Разговорный клуб или запись себя", how: "Пересказ статьи за 2 минуты", times_per_week: 2, minutes: 20, search: "english speaking club online", why: "больше говорения между уроками" },
      { skill: "vocabulary", activity: "Тренажёр слов на платформе", how: "Повторение слов урока", times_per_week: 4, minutes: 10, search: "", why: "закрепление лексики" },
    ], tips: ["Разговорный клуб раз в неделю"] },
    changes: req ? `Учёл просьбу: «${req.slice(0, 80)}».` : "",
  };
}

function insight() {
  return {
    summary: ["**Уровень B2+** — уверенный, чтение уже C1", "**Главный барьер** — артикли и продвинутая грамматика", "**Начать с** артиклей, затем инверсия"],
    strengths: ["**Беглая речь** — произношение 3/3", "**Чтение** — C1, 83%"], blockers: ["**Артикли** — 4 ошибки из 5", "**Инверсия** — 0 из 2, не использует"],
    gaps: [{ topic: "Articles with abstract nouns and geographical names", level: "C1", priority: 1, why: "ошибки в тесте" }, { topic: "Inversion", level: "C1", priority: 2, why: "не использует" }],
    skills: { grammar: "пробелы в артиклях", speaking: "упрощает грамматику" }, dynamics: "Данных пока мало",
    prefill: { goal: "Уверенный C1 для работы: переговоры и презентации", interests: "психология, путешествия, подкасты", background: "Маркетолог в IT-компании" },
  };
}

function article() {
  return { summary: "Статья о перфекционизме и его влиянии на благополучие.", vocabulary: ["self-criticism", "high standards", "burnout", "to set boundaries", "resilience"], phrasal_verbs: ["give up", "burn out"], idioms: ["at the end of the day"],
    grammar_examples: ["Perfectionism is often linked to anxiety."], grammar_note: "", reading_questions: ["What is perfectionism, according to the author?", "Do you agree with the author? Why?"], speaking: "Talk about a time you set yourself too high standards.", writing: "Write a short advice column for a perfectionist (150 words)." };
}

function pointRecs() {
  return {
    themes: [{ title: "Perfectionism", why: "Ученица интересуется психологией; в теме много абстрактных существительных.", keywords: ["perfectionism", "self-criticism"], article: "Статьи о перфекционизме и самокритике", article_query: "perfectionism wellbeing", podcast_query: "perfectionism podcast", video_query: "perfectionism TED talk" },
      { title: "Travel and mental health", why: "Путешествия + география с артиклями.", keywords: ["travel", "wellbeing"], article: "Статьи о путешествиях ради ментального здоровья", article_query: "travel mental health", podcast_query: "travel wellbeing podcast", video_query: "travel mental health" }],
    grammar: ["zero article with abstract nouns", "the + mountain ranges, rivers"], vocabulary: ["continent", "landscape", "border", "coastline", "landlocked", "heritage", "itinerary", "destination"],
    phrasal_verbs: ["set off", "stop over", "look around", "get away"], idioms: ["the world is your oyster", "off the beaten track"],
    reading: "Статья о путешествиях: ищите в журнале материалы о местах и travel wellbeing", listening: "Подкаст о путешествиях", speaking: "Describe a place you'd like to visit", writing: "A short travel review (150 words)",
  };
}

export async function mockLlm(model: string, messages: LlmMsg[]): Promise<ChatRes> {
  await new Promise((r) => setTimeout(r, 120));
  const sys = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  let out: unknown;
  if (/diagnostician/i.test(sys)) out = insight();
  else if (/Suggest what to teach AROUND|suggest 3–5 content THEMES/.test(sys)) out = pointRecs();
  else if (/uploaded an authentic text/.test(sys)) out = article();
  else if (/learning designer|learning route/i.test(sys)) out = route(user);
  else if (/reviewing a colleague/i.test(sys)) {
    // самопроверка: черновик без «лишней» правки
    const a = user.indexOf("DRAFT JSON:\n");
    const d = a >= 0 ? JSON.parse(user.slice(a + 12)) : check(user);
    out = d;
  } else out = check(user);
  return { text: JSON.stringify(out), model: `mock:${model}`, tokensIn: 100, tokensOut: 200 };
}
