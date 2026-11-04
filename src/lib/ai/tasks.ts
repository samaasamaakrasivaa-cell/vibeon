import "server-only";
import { HOWTO, PRESET, SAMPLE, TYPES, isType, type TaskType } from "../tasks/catalog";
import { liteCorrect, type Note } from "./lite";
import { goalLevel, ROUTE_TYPES, templateCriteria, templateStages, type L2, type Stage } from "../roadmap/cefr";

// Описания задач ИИ: промпт → разбор ответа; для AI_PROVIDER=mock — правдоподобный ответ без сети.

export type Kind = "help" | "file" | "split" | "book" | "explain" | "draft" | "essay" | "speech" | "precheck" | "partner" | "roadmap";
export type DraftTask = { type: TaskType; title: string; content: string; section?: "lesson" | "homework" | "words"; teacherOnly?: boolean };
export type Check = { corrected: string; notes: Note[]; summary: string; verdict?: "ok" | "partly" | "wrong" };
export type Turn = { role: "user" | "assistant"; text: string };

type Spec<I, O> = { strong?: boolean; json?: boolean; maxTokens?: number; temperature?: number; system: (i: I) => string; user: (i: I) => Turn[]; parse: (text: string, i: I) => O; mock: (i: I) => O };

const howto = (t: TaskType) => HOWTO[t]?.[1] ?? "";
const typeList = () => (Object.keys(TYPES) as TaskType[]).filter((k) => TYPES[k].g !== "tech" && HOWTO[k]).map((k) => `- ${k} (${TYPES[k].ru}): ${howto(k)}`).join("\n");
const ROLE = "Ты — помощник преподавателя английского языка на платформе VibeOn. Пиши кратко и по делу.";

export function extractJson<T>(text: string): T {
  const s = text.replace(/```(?:json)?/g, "");
  const a = s.search(/[[{]/), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (a < 0 || b < a) throw new Error("AI: no JSON in answer");
  return JSON.parse(s.slice(a, b + 1)) as T;
}
const clean = (s: string) => s.replace(/```[a-z]*\n?/g, "").replace(/```/g, "").trim();
const cleanTask = (x: Partial<DraftTask>): DraftTask | null => {
  if (!x || !isType(String(x.type))) return null;
  const type = x.type as TaskType;
  return { type, title: String(x.title ?? PRESET[type]?.[0] ?? "").slice(0, 300), content: String(x.content ?? "").slice(0, 20000), section: x.section === "homework" || x.section === "words" ? x.section : "lesson", teacherOnly: !!x.teacherOnly || undefined };
};

// ───────── Мини-словарь для заглушки ─────────
const DICT: Record<string, [string, string]> = {
  outcome: ["результат", "We can’t control the outcome."], perfectionism: ["перфекционизм", "Perfectionism can stop you from starting."], worthwhile: ["стоящий", "It’s a worthwhile project."],
  improve: ["улучшать", "I want to improve my English."], mistake: ["ошибка", "Everyone makes mistakes."], goal: ["цель", "My goal is to speak fluently."],
  travel: ["путешествовать", "I love to travel by train."], weather: ["погода", "The weather is lovely today."], job: ["работа", "She has a new job."],
  achieve: ["достигать", "You can achieve a lot in a year."], confident: ["уверенный", "He feels confident at work."], habit: ["привычка", "Reading is a good habit."],
  challenge: ["вызов, трудная задача", "Learning a language is a challenge."], experience: ["опыт", "She has a lot of experience."], deadline: ["срок", "The deadline is on Friday."],
  meeting: ["встреча", "We have a meeting at ten."], colleague: ["коллега", "My colleague helped me."], hobby: ["хобби", "My hobby is photography."],
};

function mockWordset(content: string) {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((l) => {
    const [w, tr, ex] = l.split(/\s+[—–-]\s+/).map((x) => x?.trim());
    const d = DICT[w?.toLowerCase() ?? ""];
    return [w, tr || d?.[0] || "", ex || d?.[1] || `Can you use “${w}” in a sentence?`].join(" — ");
  }).join("\n");
}

function mockHelp(type: TaskType, content: string) {
  if (!content.trim()) return SAMPLE[type] ?? "";
  if (type === "wordset") return mockWordset(content);
  const lines = content.split("\n").map((l) => l.replace(/^\s*[-•●▪]\s*/, "").trimEnd());
  if (type === "gap" || type === "drag")
    return lines.map((l) => (!l.trim() || l.includes("[") ? l : l.replace(/\b([A-Za-z’']{4,})\b(?!.*\b[A-Za-z’']{6,}\b)/, "[$1]"))).join("\n");
  if (type === "pairs" || type === "letters" || type === "crossword") return lines.map((l) => l.replace(/\s*[:=]\s*|\s+-\s+/, " — ")).join("\n");
  if (type === "test") {
    const blocks = content.trim().split(/\n\s*\n/);
    return blocks.map((b) => { const ls = b.split("\n").map((x) => x.trim()).filter(Boolean); return ls.some((x) => x.endsWith("*")) || ls.length < 3 ? ls.join("\n") : [ls[0], ls[1] + "*", ...ls.slice(2)].join("\n"); }).join("\n\n");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Заглушка «разложить текст на задания»: блоки через пустую строку, тип угадываем по разметке. */
function mockSplit(text: string): DraftTask[] {
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n|(?=^\s*(?:Exercise|Ex\.|Task|Задание)\s*\d+)/im).map((b) => b.trim()).filter((b) => b.length > 2);
  const out: DraftTask[] = [];
  for (const b of blocks.slice(0, 40)) {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    let title = "", body = lines;
    if (lines.length > 1 && lines[0].length < 120 && /[:.!?]$|^(\d+[.)]|Exercise|Ex\.|Task|Задание|Read|Listen|Match|Complete|Choose|Write|Put|Fill)/i.test(lines[0])) { title = lines[0].replace(/^(?:Exercise|Ex\.|Task|Задание)?\s*\d*[.)]?\s*/i, ""); body = lines.slice(1); }
    const c = body.join("\n");
    let type: TaskType = "text";
    if (/\[[^\]]+\]/.test(c)) type = /\*/.test(c) ? "dropdown" : "gap";
    else if (body.length >= 2 && body.every((l) => /\s[—–-]\s/.test(l))) type = body[0].split(/\s[—–-]\s/).length >= 3 ? "wordset" : "pairs";
    else if (body.some((l) => /\*$/.test(l))) type = "test";
    else if (body.length >= 2 && body.every((l) => /\s[—–-]\s*(T|F|NS)$/i.test(l))) type = "tf";
    else if (body.length >= 2 && body.every((l) => /\?$/.test(l))) type = "open";
    else if (/^(write|напиши)/i.test(title)) type = "essay";
    out.push({ type, title: title || PRESET[type]?.[0] || "", content: type === "text" ? body.join("\n") : c, section: "lesson" });
  }
  return out;
}

/** Заглушка «учебник → уроки»: заголовки Unit N / Lesson N. */
function mockBook(files: { role: string; text: string }[]) {
  const sb = files.filter((f) => f.role !== "teacher" && f.role !== "workbook").map((f) => f.text).join("\n\n");
  const wb = files.filter((f) => f.role === "workbook").map((f) => f.text).join("\n\n");
  const tb = files.filter((f) => f.role === "teacher").map((f) => f.text).join("\n\n");
  const byUnit = (s: string) => {
    const parts = s.split(/^(?=\s*(?:Unit|Module|Юнит|Раздел)\s+\d+)/im).map((x) => x.trim()).filter(Boolean);
    return parts.map((p) => { const m = p.match(/^(?:Unit|Module|Юнит|Раздел)\s+(\d+)[^\n]*/i); return { n: m ? Number(m[1]) : 0, head: m?.[0].trim() ?? "", body: m ? p.slice(m[0].length) : p }; });
  };
  const wbUnits = byUnit(wb), tbUnits = byUnit(tb);
  const units = byUnit(sb).slice(0, 30).map((u, ui) => {
    const lessons = u.body.split(/^(?=\s*(?:Lesson|Урок)\s+\d+|^\s*\d+[A-D]\s)/im).map((x) => x.trim()).filter((x) => x.length > 2);
    return {
      title: u.head || `Unit ${ui + 1}`,
      lessons: (lessons.length ? lessons : [u.body]).slice(0, 12).map((l, li) => {
        const m = l.match(/^(?:Lesson|Урок)\s+\d+[^\n]*|^\d+[A-D]\s[^\n]*/i);
        const tasks = mockSplit(m ? l.slice(m[0].length) : l);
        if (li === 0) {
          const w = wbUnits.find((x) => x.n === u.n); if (w) tasks.push(...mockSplit(w.body).slice(0, 6).map((x) => ({ ...x, section: "homework" as const })));
          const t = tbUnits.find((x) => x.n === u.n); if (t) tasks.unshift({ type: "note", title: "Teacher’s Book", content: t.body.slice(0, 3000), section: "lesson", teacherOnly: true });
        }
        return { title: m?.[0].trim() || `Lesson ${li + 1}`, tasks };
      }),
    };
  });
  return { units };
}

const RULES: [RegExp, string][] = [
  [/present perfect|have been|has been|have done|ever|already|yet/i, "Present Perfect (have/has + 3-я форма) — когда важен результат к настоящему моменту или опыт без точного времени: I have already done it. Если есть точное время в прошлом (yesterday, in 2020) — нужен Past Simple."],
  [/past simple|yesterday|ago|went|did/i, "Past Simple — законченное действие в прошлом с понятным временем: I went there yesterday. Вопрос и отрицание — с did, а глагол в начальной форме: Did you go? I didn’t go."],
  [/артикл|article|\ba\b|\ban\b|\bthe\b/i, "Артикли: a/an — «один из», когда говорим о предмете впервые; the — когда понятно, о каком именно. Перед гласным звуком — an: an apple, an hour."],
  [/used to|would/i, "used to + глагол — привычка или состояние в прошлом, которых сейчас нет: I used to live in Moscow."],
  [/conditional|if|услов/i, "Условные предложения: If + Present Simple, will + глагол — реальное будущее (If it rains, I will stay home). If + Past Simple, would + глагол — нереальное (If I had time, I would travel)."],
  [/passive|пассив|was made|is made/i, "Пассивный залог: to be + 3-я форма глагола — когда важно действие, а не кто его сделал: The house was built in 1990."],
];
function mockExplain(q: string, ctx: string, teacherTone = false) {
  const rule = RULES.find(([re]) => re.test(q) || re.test(ctx))?.[1];
  const start = teacherTone ? "Хороший вопрос!" : "Давай разберёмся.";
  return [start, rule ?? "Перечитай формулировку задания и пример в нём: ответ обычно строится по тому же образцу. Посмотри на слова вокруг пропуска — они подсказывают время и форму.", teacherTone ? "Если останутся вопросы — разберём на уроке." : "Если всё ещё непонятно — нажми «Спросить преподавателя»."].join(" ");
}

const checkParse = (text: string, src: string): Check => {
  const j = extractJson<Partial<Check>>(text);
  return { corrected: String(j.corrected ?? src), notes: Array.isArray(j.notes) ? j.notes.slice(0, 40).map((n) => ({ from: String(n.from ?? ""), to: String(n.to ?? ""), why: String(n.why ?? "") })) : [], summary: String(j.summary ?? ""), verdict: j.verdict === "ok" || j.verdict === "partly" || j.verdict === "wrong" ? j.verdict : undefined };
};
const CHECK_FORMAT = `Ответь только JSON: {"corrected": "исправленный текст целиком (сохрани стиль ученика, правь только ошибки)", "notes": [{"from": "как было", "to": "как надо", "why": "короткое объяснение по-русски"}], "summary": "2–3 предложения по-русски: что получилось хорошо и над чем поработать", "verdict": "ok | partly | wrong"}`;
const mockCheck = (text: string, praise: string): Check => {
  const { corrected, notes } = liteCorrect(text);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { corrected, notes, summary: `${praise} ${notes.length ? `Найдено ошибок: ${notes.length} — посмотри исправления в тексте.` : "Ошибок не нашлось."}${words < 40 ? " Попробуй написать подробнее." : ""}`, verdict: notes.length === 0 ? "ok" : notes.length < 4 ? "partly" : "wrong" };
};

export const SPECS = {
  help: {
    system: (i) => `${ROLE} Помогаешь заполнить задание типа «${TYPES[i.type].ru}». Формат разметки: ${howto(i.type)} Верни ТОЛЬКО содержание задания в этой разметке, без пояснений. Если поле пустое — придумай содержание по теме урока и уровню. Если в поле что-то есть — дополни и приведи к разметке.${i.type === "wordset" ? " Для каждого слова: слово — перевод на русский — пример на английском." : ""}`,
    user: (i) => [{ role: "user", text: `Урок: ${i.lesson || "—"}. Уровень: ${i.level || "—"}. Формулировка: ${i.title || "—"}.\nПоле сейчас:\n${i.content || "(пусто)"}` }],
    parse: (t) => ({ content: clean(t) }),
    mock: (i) => ({ content: mockHelp(i.type, i.content) }),
  } as Spec<{ type: TaskType; title: string; content: string; lesson?: string; level?: string }, { content: string }>,

  file: {
    maxTokens: 4000,
    system: (i) => `${ROLE} Тебе дают текст, распознанный из файла (Word, PDF, фото страницы). Преврати его в содержание задания типа «${TYPES[i.type].ru}». Формат разметки: ${howto(i.type)} Верни ТОЛЬКО содержание в этой разметке.`,
    user: (i) => [{ role: "user", text: i.text.slice(0, 12000) }],
    parse: (t) => ({ content: clean(t) }),
    mock: (i) => ({ content: i.type === "text" || i.type === "note" ? i.text.trim() : mockHelp(i.type, i.text.trim().split("\n").slice(0, 60).join("\n")) }),
  } as Spec<{ type: TaskType; text: string }, { content: string }>,

  split: {
    json: true, maxTokens: 6000,
    system: () => `${ROLE} Разложи материал (распознанный из файла) на задания урока. Типы и разметка:\n${typeList()}\nОтветь только JSON: {"tasks": [{"type": "gap", "title": "формулировка задания", "content": "содержание в разметке"}]}`,
    user: (i) => [{ role: "user", text: i.text.slice(0, 14000) }],
    parse: (t) => ({ tasks: (extractJson<{ tasks: Partial<DraftTask>[] }>(t).tasks ?? []).map(cleanTask).filter((x): x is DraftTask => !!x) }),
    mock: (i) => ({ tasks: mockSplit(i.text) }),
  } as Spec<{ text: string }, { tasks: DraftTask[] }>,

  book: {
    json: true, maxTokens: 8000,
    system: () => `${ROLE} Тебе дают текст учебника (роль файла указана: student — Student’s Book, workbook — Workbook, teacher — Teacher’s Book). Разложи материал по юнитам и урокам. Задания Workbook — в домашку (section: "homework"), заметки Teacher’s Book — задание type "note" с "teacherOnly": true. Типы и разметка:\n${typeList()}\nОтветь только JSON: {"units": [{"title": "Unit 1 …", "lessons": [{"title": "Lesson 1 …", "tasks": [{"type": "…", "title": "…", "content": "…", "section": "lesson | homework"}]}]}]}`,
    user: (i) => [{ role: "user", text: i.files.map((f) => `=== ${f.role} ===\n${f.text}`).join("\n\n").slice(0, 24000) }],
    parse: (t) => {
      const j = extractJson<{ units: { title: string; lessons: { title: string; tasks: Partial<DraftTask>[] }[] }[] }>(t);
      return { units: (j.units ?? []).map((u) => ({ title: String(u.title ?? "Unit"), lessons: (u.lessons ?? []).map((l) => ({ title: String(l.title ?? "Lesson"), tasks: (l.tasks ?? []).map(cleanTask).filter((x): x is DraftTask => !!x) })) })) };
    },
    mock: (i) => mockBook(i.files),
  } as Spec<{ files: { role: string; text: string }[] }, { units: { title: string; lessons: { title: string; tasks: DraftTask[] }[] }[] }>,

  explain: {
    system: (i) => `${ROLE} Ученик (уровень ${i.level || "не указан"}) не понял задание и спрашивает. Объясни по-русски, просто и коротко (до 6 предложений), опираясь на правила и примеры из задания. Не давай готовых ответов на всё задание — подскажи, как рассуждать. В конце предложи спросить преподавателя, если останется непонятно.`,
    user: (i) => [{ role: "user", text: `Задание: ${i.task || "—"}\nВопрос ученика: ${i.question}` }],
    parse: (t) => ({ answer: clean(t) }),
    mock: (i) => ({ answer: mockExplain(i.question, i.task) }),
  } as Spec<{ question: string; task: string; level?: string }, { answer: string }>,

  draft: {
    system: () => `${ROLE} Составь черновик ответа преподавателя на вопрос ученика: по-русски, дружелюбно, 2–5 предложений, с примером на английском.`,
    user: (i) => [{ role: "user", text: `Контекст: ${i.context || "—"}\nВопрос: ${i.question}${i.ai ? `\nИИ уже ответил ученику: ${i.ai}` : ""}` }],
    parse: (t) => ({ answer: clean(t) }),
    mock: (i) => ({ answer: mockExplain(i.question, i.context, true) }),
  } as Spec<{ question: string; context: string; ai?: string }, { answer: string }>,

  essay: {
    strong: true, json: true, maxTokens: 4000,
    system: (i) => `${ROLE} Проверь эссе ученика (уровень ${i.level || "не указан"}${i.limit ? `, лимит ${i.limit} слов` : ""}). Исправь грамматику, лексику, орфографию и пунктуацию; оцени, раскрыта ли тема. ${CHECK_FORMAT}`,
    user: (i) => [{ role: "user", text: `Тема: ${i.task || "—"}\nЭссе:\n${i.text}` }],
    parse: (t, i) => checkParse(t, i.text),
    mock: (i) => mockCheck(i.text, "Тема раскрыта, мысль понятна."),
  } as Spec<{ task: string; text: string; level?: string; limit?: number }, Check>,

  speech: {
    strong: true, json: true, maxTokens: 3000,
    system: () => `${ROLE} Это расшифровка устного ответа ученика. Сделай исправленную версию (как сказал бы носитель, сохраняя смысл) и отметь ошибки. Ошибки распознавания речи не считай ошибками ученика. ${CHECK_FORMAT}`,
    user: (i) => [{ role: "user", text: `Задание: ${i.task || "—"}\nРасшифровка:\n${i.text}` }],
    parse: (t, i) => checkParse(t, i.text),
    mock: (i) => mockCheck(i.text, "Хорошо, что говоришь развёрнуто."),
  } as Spec<{ task: string; text: string }, Check>,

  precheck: {
    strong: true, json: true, maxTokens: 3000,
    system: () => `${ROLE} Предварительно проверь ответы ученика на задание, чтобы преподавателю было быстрее. Верные по смыслу ответы, отличающиеся от эталона формулировкой, считай верными. ${CHECK_FORMAT}`,
    user: (i) => [{ role: "user", text: `Задание: ${i.task}\n${i.expected ? `Эталон: ${i.expected}\n` : ""}Ответ ученика:\n${i.text}` }],
    parse: (t, i) => checkParse(t, i.text),
    mock: (i) => mockCheck(i.text, "Ответы по делу."),
  } as Spec<{ task: string; text: string; expected?: string }, Check>,

  partner: {
    maxTokens: 400, temperature: 0.7,
    system: (i) => `You are a friendly English conversation partner for a student (level ${i.level || "unknown"}). ${i.prompt ? `Your role: ${i.prompt}. ` : ""}${i.goal ? `Goal of the conversation: ${i.goal}. ` : ""}${i.words ? `Gently encourage the student to use these words: ${i.words}. ` : ""}Questions to cover: ${i.questions || "any"}. Speak simply, 1–3 short sentences per turn, always end with a question. If the student makes a mistake, repeat the phrase correctly in passing, without lecturing. Reply in English only.`,
    user: (i) => (i.history.length ? i.history : [{ role: "user", text: "Hi! Let's start." }]),
    parse: (t) => ({ reply: clean(t) }),
    mock: (i) => {
      const qs = (i.questions || "").split("\n").map((x) => x.trim()).filter(Boolean);
      const n = i.history.filter((h) => h.role === "assistant").length;
      const last = [...i.history].reverse().find((h) => h.role === "user")?.text ?? "";
      const fixed = last ? liteCorrect(last) : null;
      const react = n === 0 ? "Hi! Nice to talk to you." : fixed?.notes.length ? `I see! By the way, we say: “${fixed.corrected.trim()}”` : ["That’s interesting!", "Great answer!", "I see, thanks for sharing.", "Oh, really? Cool."][n % 4];
      const q = qs[n] ?? (i.goal ? `Let’s keep going: ${i.goal}. What do you think?` : ["What do you like doing at the weekend?", "Can you tell me more about that?", "Why do you think so?", "What was the best part?"][n % 4]);
      const words = i.words ? ` Try to use: ${i.words}.` : "";
      return { reply: `${react} ${q}${n === 0 ? words : ""}` };
    },
  } as Spec<{ history: Turn[]; prompt?: string; goal?: string; words?: string; questions?: string; level?: string }, { reply: string }>,
  roadmap: {
    strong: true, json: true, maxTokens: 6000,
    system: () => `${ROLE} Составь маршрут ученика к цели по шкале CEFR (или баллам экзамена). Этапы — от текущего уровня к цели, у каждого: уровень, название, учебные часы (реалистично, по рекомендациям Cambridge: A1→A2 ≈ 100 ч, A2→B1 ≈ 170 ч, B1→B2 ≈ 200 ч, B2→C1 ≈ 200 ч), что входит (грамматика, лексика), что ученик сможет (can-do) и как он будет себя чувствовать. Учитывай слабые места по тесту, темп, как ученик занимается, комментарий учителя и юниты ведущего курса. Пиши по-русски. Ответь только JSON: {"stages": [{"lvl": "B1+", "title": "…", "hours": 90, "grammar": ["…"], "vocabulary": ["…"], "skills": ["…"], "feel": ["…"]}], "criteria": ["критерий достижения цели"], "summary": "2–3 предложения для учителя: на чём фокус и почему"}`,
    user: (i) => [{ role: "user", text: [
      `Тип маршрута: ${ROUTE_TYPES[i.type]?.name[1] ?? i.type}. Сейчас: ${i.from}. Цель: ${i.goal} (≈ ${goalLevel(i.type, i.goal)}).`,
      i.skills ? `Входной тест по навыкам, %: ${Object.entries(i.skills).map(([k, v]) => `${k} ${v}`).join(", ")}.` : "Входного теста нет.",
      i.weak?.length ? `Слабые места: ${i.weak.join("; ")}.` : "",
      `Темп: ${i.pace}. Как занимается: ${i.mood === "more" ? "занимается больше плана" : i.mood === "slack" ? "бывают пропуски" : "по плану"}.`,
      i.units?.length ? `Юниты ведущего курса по порядку: ${i.units.map((u) => u.title).join("; ")}.` : "Ведущего курса нет — общий маршрут по уровням.",
      i.note ? `Комментарий учителя: ${i.note}` : "",
    ].filter(Boolean).join("\n") }],
    parse: (t, i) => {
      const j = extractJson<{ stages?: Partial<Stage>[]; criteria?: string[]; summary?: string }>(t);
      const arr = (x: unknown) => (Array.isArray(x) ? x.map(String).slice(0, 8) : []);
      const stages = (j.stages ?? []).filter((x) => x && x.lvl).slice(0, 12).map((x) => ({ lvl: String(x.lvl).slice(0, 20), title: String(x.title ?? x.lvl).slice(0, 120), hours: Math.max(5, Math.min(400, Math.round(Number(x.hours) || 40))), grammar: arr(x.grammar), vocabulary: arr(x.vocabulary), skills: arr(x.skills), feel: arr(x.feel) }));
      if (!stages.length) return SPECS.roadmap.mock(i);
      return { stages, criteria: arr(j.criteria), summary: String(j.summary ?? "").slice(0, 1000) };
    },
    mock: (i) => {
      const stages = templateStages(i.type, i.from, i.goal, i.units);
      const k = i.mood === "slack" ? 1.1 : i.mood === "more" ? 0.95 : 1;
      for (const s of stages) s.hours = Math.round((s.hours * k) / 5) * 5;
      if (i.weak?.length && stages[0]) stages[0].grammar = [...stages[0].grammar, [`Weak spots from the test: ${i.weak.slice(0, 3).join(", ")}`, `Слабые места по тесту: ${i.weak.slice(0, 3).join(", ")}`] as L2];
      const total = stages.reduce((a, s) => a + s.hours, 0);
      return {
        stages, criteria: templateCriteria(i.type, i.goal),
        summary: `Маршрут ${i.from} → ${i.goal}: ${stages.length} этапов, около ${total} учебных часов.${i.weak?.length ? ` Сначала — слабые места по тесту: ${i.weak.slice(0, 2).join(", ")}.` : ""}${i.units?.length ? ` Опираемся на ведущий курс: ${i.units.length} юнитов.` : ""}${i.mood === "slack" ? " Заложен запас времени на пропуски." : ""}`,
      };
    },
  } as Spec<{ type: string; from: string; goal: string; skills?: Record<string, number>; weak?: string[]; pace: string; mood?: string; note?: string; units?: { title: string }[] }, { stages: Stage[]; criteria: (L2 | string)[]; summary: string }>,
} satisfies Record<Kind, Spec<never, unknown>>;

export type SpecIn<K extends Kind> = Parameters<(typeof SPECS)[K]["system"]>[0];
export type SpecOut<K extends Kind> = ReturnType<(typeof SPECS)[K]["mock"]>;
