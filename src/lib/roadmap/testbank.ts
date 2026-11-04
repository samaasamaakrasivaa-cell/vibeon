// Входной тест и срезы: банк вопросов по уровням A1–C1 и подсчёт результата (кодом, без ИИ).
// Письмо проверяет ИИ (как эссе), остальное — точное совпадение.

import { LEVELS, type Skill } from "./cefr";

export type Item = { id: string; skill: Skill; level: string; q: string; options: string[]; answer: number; topic: [string, string]; passage?: string; say?: string };

const P_A2 = "Tom lives in a small town near the sea. Every morning he walks his dog on the beach before work. He works in a café, and he loves talking to tourists in summer. In winter the town is very quiet, so Tom reads a lot and visits his sister in the city.";
const P_B2 = "Remote work was once seen as a perk for a lucky few, but it has quickly become the norm in many industries. Supporters argue that it saves time and money and lets people organise their day around their lives. Critics, however, worry that young employees miss out on informal learning — the kind of knowledge that is picked up by overhearing colleagues rather than being formally taught. Many companies are now experimenting with hybrid models, hoping to keep the flexibility without losing the sense of a shared workplace.";

export const BANK: Item[] = [
  // Грамматика
  { id: "g1", skill: "grammar", level: "A1", q: "She ___ a teacher.", options: ["am", "is", "are"], answer: 1, topic: ["to be", "Глагол to be"] },
  { id: "g2", skill: "grammar", level: "A1", q: "___ you like coffee?", options: ["Do", "Does", "Are"], answer: 0, topic: ["Present Simple questions", "Вопросы в Present Simple"] },
  { id: "g3", skill: "grammar", level: "A1", q: "There ___ two cats in the garden.", options: ["is", "are", "be"], answer: 1, topic: ["there is / are", "there is / are"] },
  { id: "g4", skill: "grammar", level: "A2", q: "Yesterday I ___ to the cinema.", options: ["go", "went", "have gone"], answer: 1, topic: ["Past Simple", "Past Simple"] },
  { id: "g5", skill: "grammar", level: "A2", q: "This bag is ___ than that one.", options: ["more cheap", "cheaper", "cheapest"], answer: 1, topic: ["Comparatives", "Степени сравнения"] },
  { id: "g6", skill: "grammar", level: "A2", q: "Look at the clouds! It ___ rain.", options: ["is going to", "will to", "goes to"], answer: 0, topic: ["Future: going to", "Будущее: going to"] },
  { id: "g7", skill: "grammar", level: "B1", q: "I ___ in this city since 2019.", options: ["live", "lived", "have lived"], answer: 2, topic: ["Present Perfect vs Past Simple", "Present Perfect и Past Simple"] },
  { id: "g8", skill: "grammar", level: "B1", q: "If it rains tomorrow, we ___ at home.", options: ["stay", "will stay", "would stay"], answer: 1, topic: ["First conditional", "Первое условное"] },
  { id: "g9", skill: "grammar", level: "B1", q: "I ___ play football every weekend when I was a child.", options: ["used to", "use to", "was used to"], answer: 0, topic: ["used to", "used to"] },
  { id: "g10", skill: "grammar", level: "B2", q: "She said that she ___ the report the day before.", options: ["finished", "has finished", "had finished"], answer: 2, topic: ["Reported speech", "Косвенная речь"] },
  { id: "g11", skill: "grammar", level: "B2", q: "The new bridge ___ by the end of next year.", options: ["will have been built", "will build", "is building"], answer: 0, topic: ["Passive in all tenses", "Пассив во всех временах"] },
  { id: "g12", skill: "grammar", level: "B2", q: "He ___ be at home — the lights are off.", options: ["can’t", "mustn’t", "shouldn’t"], answer: 0, topic: ["Modals of deduction", "Модальные предположения"] },
  { id: "g13", skill: "grammar", level: "C1", q: "Not only ___ late, but he also forgot the tickets.", options: ["he was", "was he", "he has been"], answer: 1, topic: ["Inversion", "Инверсия"] },
  { id: "g14", skill: "grammar", level: "C1", q: "If I had taken that job, I ___ in London now.", options: ["would live", "would be living", "will live"], answer: 1, topic: ["Mixed conditionals", "Смешанные условные"] },
  { id: "g15", skill: "grammar", level: "C1", q: "___ the report, she sent it to her manager.", options: ["Having finished", "Finished", "Having finish"], answer: 0, topic: ["Participle clauses", "Причастные обороты"] },
  // Лексика
  { id: "v1", skill: "vocabulary", level: "A1", q: "My mother’s brother is my ___.", options: ["cousin", "uncle", "nephew"], answer: 1, topic: ["Family", "Семья"] },
  { id: "v2", skill: "vocabulary", level: "A1", q: "I ___ breakfast at 8 o’clock.", options: ["make", "have", "do"], answer: 1, topic: ["Daily routine", "Распорядок дня"] },
  { id: "v3", skill: "vocabulary", level: "A2", q: "I need to ___ a room at the hotel.", options: ["book", "buy", "rent out"], answer: 0, topic: ["Travel", "Путешествия"] },
  { id: "v4", skill: "vocabulary", level: "A2", q: "I feel ill. I think I’ve ___ a cold.", options: ["took", "caught", "got up"], answer: 1, topic: ["Health", "Здоровье"] },
  { id: "v5", skill: "vocabulary", level: "B1", q: "Don’t give ___ — you’re almost there!", options: ["up", "in", "out"], answer: 0, topic: ["Phrasal verbs", "Фразовые глаголы"] },
  { id: "v6", skill: "vocabulary", level: "B1", q: "It was raining. ___, we went for a walk.", options: ["However", "Because", "Although"], answer: 0, topic: ["Linking words", "Слова-связки"] },
  { id: "v7", skill: "vocabulary", level: "B2", q: "The company decided to ___ the meeting until Friday.", options: ["put off", "put up", "put on"], answer: 0, topic: ["Work vocabulary", "Рабочая лексика"] },
  { id: "v8", skill: "vocabulary", level: "B2", q: "Her ___ to the project was huge.", options: ["contribute", "contribution", "contributor"], answer: 1, topic: ["Word formation", "Словообразование"] },
  { id: "v9", skill: "vocabulary", level: "C1", q: "The results were ___ — nobody could have predicted them.", options: ["unprecedented", "unaware", "uneventful"], answer: 0, topic: ["Advanced vocabulary", "Продвинутая лексика"] },
  { id: "v10", skill: "vocabulary", level: "C1", q: "He tends to ___ around the bush instead of answering.", options: ["beat", "hit", "run"], answer: 0, topic: ["Idioms", "Идиомы"] },
  // Чтение
  { id: "r1", skill: "reading", level: "A2", passage: P_A2, q: "Where does Tom work?", options: ["On the beach", "In a café", "In the city"], answer: 1, topic: ["Reading: details", "Чтение: детали"] },
  { id: "r2", skill: "reading", level: "A2", passage: P_A2, q: "What does Tom do in winter?", options: ["He works more", "He reads and visits his sister", "He travels abroad"], answer: 1, topic: ["Reading: details", "Чтение: детали"] },
  { id: "r3", skill: "reading", level: "A2", passage: P_A2, q: "Tom likes summer because…", options: ["the town is quiet", "he can talk to tourists", "he has a holiday"], answer: 1, topic: ["Reading: main idea", "Чтение: главная мысль"] },
  { id: "r4", skill: "reading", level: "B2", passage: P_B2, q: "What do critics of remote work worry about?", options: ["Higher costs", "Young employees losing informal learning", "Longer working days"], answer: 1, topic: ["Reading: the writer’s point", "Чтение: позиция автора"] },
  { id: "r5", skill: "reading", level: "B2", passage: P_B2, q: "“Picked up” in the text means…", options: ["learned without being taught", "collected from the floor", "chosen carefully"], answer: 0, topic: ["Reading: meaning from context", "Чтение: значение из контекста"] },
  { id: "r6", skill: "reading", level: "C1", passage: P_B2, q: "What is the main purpose of hybrid models, according to the text?", options: ["To cut salaries", "To combine flexibility with a shared workplace", "To end remote work"], answer: 1, topic: ["Reading: implied meaning", "Чтение: подтекст"] },
  // Аудирование (платформа зачитывает фразу)
  { id: "l1", skill: "listening", level: "A1", say: "Hi, I’m Kate. I’m from Canada and I’m twenty-five.", q: "Where is Kate from?", options: ["Canada", "America", "Australia"], answer: 0, topic: ["Listening: personal details", "Аудирование: личные данные"] },
  { id: "l2", skill: "listening", level: "A2", say: "The train to Oxford leaves at a quarter past ten from platform four.", q: "When does the train leave?", options: ["10:15", "10:45", "4:10"], answer: 0, topic: ["Listening: numbers and time", "Аудирование: числа и время"] },
  { id: "l3", skill: "listening", level: "B1", say: "I was going to take the bus, but it was so nice outside that I decided to walk instead, even though it took me forty minutes.", q: "How did the speaker get there?", options: ["By bus", "On foot", "By car"], answer: 1, topic: ["Listening: main point", "Аудирование: главное"] },
  { id: "l4", skill: "listening", level: "B2", say: "Frankly, the proposal isn’t bad, but unless we can bring the costs down, I don’t see the board approving it this quarter.", q: "What does the speaker think?", options: ["The board will approve it now", "Costs must fall for approval", "The proposal is terrible"], answer: 1, topic: ["Listening: attitude", "Аудирование: позиция говорящего"] },
  { id: "l5", skill: "listening", level: "C1", say: "Had they consulted the local community from the outset, much of the backlash could arguably have been avoided.", q: "What does the speaker suggest?", options: ["The community caused the problem", "Earlier consultation would have reduced the criticism", "The project was a success"], answer: 1, topic: ["Listening: complex speech", "Аудирование: сложная речь"] },
];

export const WRITING_PROMPT = "Write 60–120 words: describe your typical week and one thing you would like to change about it.";

/** Вопросы для среза: уровни рядом с этапом (на ступень ниже, этот и выше). */
export function itemsFor(kind: "entry" | "slice" | "final", level?: string | null) {
  if (kind === "entry" || !level) return BANK;
  const base = level.replace(/[+−-]$/, "");
  const order = ["A1", "A2", "B1", "B2", "C1"];
  const i = Math.max(0, order.indexOf(base));
  const near = new Set(order.slice(Math.max(0, i - 1), i + 2));
  return BANK.filter((x) => near.has(x.level));
}

export type Result = { level: string; skills: Partial<Record<Skill, number>>; weak: [string, string][]; strong: [string, string][]; score: number };

/** Подсчёт: процент по навыкам (с весом уровня вопроса) и уровень — самый высокий, где верно ≥ 60%. */
export function grade(items: Item[], answers: Record<string, number>, writing?: number | null): Result {
  const skills: Partial<Record<Skill, number>> = {};
  const W: Record<string, number> = { A1: 1, A2: 1.3, B1: 1.6, B2: 2, C1: 2.4 };
  for (const sk of ["grammar", "vocabulary", "reading", "listening"] as Skill[]) {
    const its = items.filter((x) => x.skill === sk);
    if (!its.length) continue;
    const tot = its.reduce((a, x) => a + W[x.level], 0), got = its.reduce((a, x) => a + (answers[x.id] === x.answer ? W[x.level] : 0), 0);
    skills[sk] = Math.round((got / tot) * 100);
  }
  if (writing !== undefined && writing !== null) skills.writing = Math.round(writing);
  const order = ["A1", "A2", "B1", "B2", "C1"];
  let level = "A1";
  for (const l of order) {
    const its = items.filter((x) => x.level === l);
    if (!its.length) continue;
    const acc = its.filter((x) => answers[x.id] === x.answer).length / its.length;
    if (acc >= 0.6) level = l; else { if (acc >= 0.4 && l !== "A1") level = `${order[order.indexOf(l) - 1]}+`; break; }
  }
  if (!(LEVELS as readonly string[]).includes(level)) level = "A1";
  const wrong = items.filter((x) => answers[x.id] !== x.answer);
  const right = items.filter((x) => answers[x.id] === x.answer);
  const uniq = (xs: Item[]) => [...new Map(xs.map((x) => [x.topic[0], x.topic])).values()];
  const vals = Object.values(skills) as number[];
  return { level, skills, weak: uniq(wrong).slice(0, 6), strong: uniq(right.filter((x) => x.level !== "A1")).slice(0, 4), score: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0 };
}

/** Ответы ученику без правильных вариантов. */
export const publicItems = (items: Item[]) => items.map(({ answer: _a, ...x }) => x); // eslint-disable-line @typescript-eslint/no-unused-vars
