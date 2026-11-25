import "server-only";
// Диктовка учителя по-русски: английские термины распознаватель пишет кириллицей («презент перфект»).
// Модель возвращает их латиницей, русский текст не трогает. При сбое или подозрительном ответе — исходный текст.
import { llmFor, type Ctx } from "./gateway";
import { modelsFor } from "./models";
import { prompt } from "./prompts";

export async function sttFix(text: string, ctx: Ctx) {
  if (text.length < 6 || !/[а-яё]/i.test(text)) return text;
  try {
    const r = await llmFor("route", ctx)(modelsFor("route")[0], [{ role: "system", content: prompt("stt-fix") }, { role: "user", content: text }], { temperature: 0, maxTokens: Math.min(4000, text.length * 2 + 200), timeoutMs: 20000 });
    const out = r.text.trim().replace(/^["«]|["»]$/g, "");
    // защита: ответ не должен заметно отличаться по длине (модель не пересказывает и не дописывает)
    return out && out.length > text.length * 0.6 && out.length < text.length * 1.5 ? out : text;
  } catch (e) { console.error("[stt-fix]", (e as Error).message); return text; }
}
