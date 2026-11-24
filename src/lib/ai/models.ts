// Какая модель отвечает за какую задачу — задаётся в .env (имя модели в Yandex AI Studio, например deepseek-v32/latest).
// Основная модель; если она не ответила или дважды вернула не-JSON — запасная.

export type Purpose = "check" | "route";

const DEFAULTS: Record<Purpose, [string, string]> = {
  // по сравнению на размеченных работах A2–C1 (scripts/ai-eval.ts): DeepSeek V4.1 Flash — лучший на всех уровнях
  // и единственный, кто везде соблюдает язык пояснений; V3.2 — почти так же точен, запасной
  check: ["deepseek-v4.1-flash/latest", "deepseek-v32/latest"],
  route: ["deepseek-v4.1-flash/latest", "deepseek-v32/latest"],
};

const env = (k: string) => (process.env[k] || "").trim();

// Уровень ученика → своя пара моделей: с AI_CHECK_HIGH_FROM (по умолчанию B2) — AI_MODEL_CHECK_HIGH / _HIGH_FALLBACK, если заданы.
// К имени модели можно добавить «#low» / «#medium» / «#high» — модель будет «размышлять» перед ответом (дольше, точнее на сложных текстах).
const LV = ["A1", "A2", "A2+", "B1", "B1+", "B2-", "B2", "B2+", "C1-", "C1", "C1+", "C2"];
const rank = (l?: string | null) => LV.indexOf((l ?? "").trim().replace("−", "-"));
export const isHighLevel = (level?: string | null) => { const r = rank(level), from = rank(env("AI_CHECK_HIGH_FROM") || "B2"); return r >= 0 && from >= 0 && r >= from; };

/** [основная, запасная] — без повторов и пустых. Для проверки работ — с учётом уровня ученика. */
export function modelsFor(p: Purpose, level?: string | null): string[] {
  const up = p.toUpperCase();
  if (p === "check" && isHighLevel(level) && env("AI_MODEL_CHECK_HIGH")) {
    return [...new Set([env("AI_MODEL_CHECK_HIGH"), env("AI_MODEL_CHECK_HIGH_FALLBACK") || env("AI_MODEL_CHECK") || DEFAULTS.check[0]].filter(Boolean))];
  }
  const main = env(`AI_MODEL_${up}`) || DEFAULTS[p][0];
  const fb = env(`AI_MODEL_${up}_FALLBACK`) || DEFAULTS[p][1];
  return [...new Set([main, fb].filter(Boolean))];
}

const NAMES: [RegExp, string][] = [
  [/deepseek-v32/, "DeepSeek V3.2"], [/deepseek-v4\.1-flash/, "DeepSeek V4.1 Flash"], [/deepseek-v4-flash/, "DeepSeek V4 Flash"],
  [/aliceai-llm-flash/, "Alice AI LLM Flash"], [/aliceai-llm/, "Alice AI LLM"], [/qwen3-235b/, "Qwen3-235B"], [/qwen3\.6-35b/, "Qwen3.6 35B"],
  [/yandexgpt-5-pro/, "YandexGPT 5 Pro"], [/yandexgpt-5\.1/, "YandexGPT 5.1"], [/yandexgpt-lite/, "YandexGPT Lite"], [/yandexgpt/, "YandexGPT"], [/^mock/, "Тестовая модель"],
];
/** Человеческое название модели для интерфейса. */
export const modelLabel = (m: string) => {
  const [name, think] = m.split("#");
  const base = NAMES.find(([re]) => re.test(name))?.[1] ?? name.replace(/^gpt:\/\/[^/]+\//, "").replace(/\/latest$/, "");
  return think && think !== "none" ? `${base} · размышления` : base;
};
