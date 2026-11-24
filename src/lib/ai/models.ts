// Какая модель отвечает за какую задачу — задаётся в .env (имя модели в Yandex AI Studio, например deepseek-v32/latest).
// Основная модель; если она не ответила или дважды вернула не-JSON — запасная.

export type Purpose = "check" | "route";

const DEFAULTS: Record<Purpose, [string, string]> = {
  check: ["deepseek-v32/latest", "aliceai-llm/latest"],
  route: ["deepseek-v32/latest", "aliceai-llm/latest"],
};

const env = (k: string) => (process.env[k] || "").trim();

/** [основная, запасная] — без повторов и пустых. */
export function modelsFor(p: Purpose): string[] {
  const up = p.toUpperCase();
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
export const modelLabel = (m: string) => NAMES.find(([re]) => re.test(m))?.[1] ?? m.replace(/^gpt:\/\/[^/]+\//, "").replace(/\/latest$/, "");
