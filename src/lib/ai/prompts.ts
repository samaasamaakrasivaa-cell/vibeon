import "server-only";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

// Системные инструкции ИИ лежат в prompts/*.md — их можно править без изменения кода.
// Файл перечитывается, если изменился (по времени изменения), иначе берётся из памяти.
const cache = new Map<string, { at: number; text: string }>();
export type PromptName = "check-1" | "check-2-review" | "route" | "image" | "route-insight" | "route-point" | "route-article";

export function prompt(name: PromptName): string {
  const file = path.join(process.cwd(), "prompts", `${name}.md`);
  const at = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.at === at) return hit.text;
  const text = readFileSync(file, "utf8").trim();
  cache.set(file, { at, text });
  return text;
}
