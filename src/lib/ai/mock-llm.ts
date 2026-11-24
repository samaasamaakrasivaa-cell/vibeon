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
  const from = /"overall_level"\s*:\s*"([^"]+)"/.exec(user)?.[1] ?? /placement[^\n]*?([ABC][12]\+?)/.exec(user)?.[1] ?? "B1";
  const goal = /"goal"\s*:\s*"([^"]+)"/.exec(user)?.[1] ?? "B2";
  return {
    start: { overall_level: from, skills: { grammar_vocab: from, reading: from, listening: from, writing: from, speaking: from }, gaps: ["listening ниже остальных — приоритет первого этапа"] },
    goal: { level: goal, exam: null, explanation: "Уверенное общение на большинство тем, понимание речи в обычном темпе." },
    weekly_hours: 5.5,
    stages: [
      { id: 1, title: `${from} → ${from}+`, study_hours: 80, forecast_weeks: 15, focus: ["listening: короткие подкасты", "grammar: Present Perfect vs Past Simple", "vocabulary: путешествия, работа"], units: [], can_do_after: ["понимает основное в подкастах о знакомых темах"], checkpoint: { tests: ["listening", "grammar_vocab"], pass_rule: "от 70% по аудированию и грамматике" } },
      { id: 2, title: `${from}+ → ${goal}`, study_hours: 100, forecast_weeks: 18, focus: ["speaking: рассуждение", "grammar: условные предложения", "vocabulary: абстрактные темы"], units: [], can_do_after: ["может аргументировать мнение"], checkpoint: { tests: ["speaking", "writing"], pass_rule: "от 70% по говорению и письму" } },
    ],
    total_hours: 180, forecast_weeks: 33, deadline_check: null,
    risks: ["Мало самостоятельной практики — прогноз сдвинется."],
    pace_options: [{ lessons_per_week: 2, daily_minutes: 20, forecast_weeks: 33 }, { lessons_per_week: 3, daily_minutes: 20, forecast_weeks: 25 }],
    teacher_summary: "Главный приоритет — аудирование. Рекомендуемый темп — 2 урока в неделю и 20 минут в день.",
    student_message: "Ты уверенно стоишь на своём уровне. Впереди — путь к цели; первая точка — свободнее понимать речь на слух.",
  };
}

export async function mockLlm(model: string, messages: LlmMsg[]): Promise<ChatRes> {
  await new Promise((r) => setTimeout(r, 120));
  const sys = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  let out: unknown;
  if (/learning designer|learning route/i.test(sys)) out = route(user);
  else if (/reviewing a colleague/i.test(sys)) {
    // самопроверка: черновик без «лишней» правки
    const a = user.indexOf("DRAFT JSON:\n");
    const d = a >= 0 ? JSON.parse(user.slice(a + 12)) : check(user);
    out = d;
  } else out = check(user);
  return { text: JSON.stringify(out), model: `mock:${model}`, tokensIn: 100, tokensOut: 200 };
}
