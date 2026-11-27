import type { lessonModelEvidence } from "../lessons/analysis-facts";

export const LESSON_ANALYSIS_MODEL = "deepseek-v4.1-flash/latest";
export const LESSON_ANALYSIS_MONTHLY_LIMIT = 200;
export const LESSON_ANALYSIS_OUTPUT_TOKENS = 500;
export const LESSON_ANALYSIS_ESTIMATE_RUB = 0.61;

type Evidence = ReturnType<typeof lessonModelEvidence>;
const formats = ["drill", "apply", "recall"] as const;
export type Practice = { code: string; format: (typeof formats)[number] };

const system = "Recommend up to two concrete practice plans for the next English lesson. Rank topics with observed errors before topics for consolidation. Use only given topic codes. Choose format drill for targeted short practice, apply for using the topic in context, recall for no-notes retrieval. Return only a JSON array of objects with code and format. No original text or explanations.";

export function lessonAnalysisInput(evidence: Evidence) {
  const included = [...evidence];
  // Input is ASCII and byte-bounded. The token estimate also allows for the chat envelope.
  let content = JSON.stringify(included);
  while (system.length + content.length > 950 && included.length) {
    included.pop();
    content = JSON.stringify(included);
  }
  return { included, messages: [{ role: "system", content: system }, { role: "user", content }] as const };
}

export function localPractice(evidence: Evidence): Practice[] {
  return evidence.slice(0, 2).map((topic) => ({
    code: topic.code,
    format: topic.incorrect > 0 ? "drill" : topic.correct > 0 ? "recall" : "apply",
  }));
}

/** The provider may propose only known topics and approved exercise formats. */
export function parseLessonPractice(text: string, evidence: Evidence): Practice[] | null {
  let value: unknown;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const allowed = new Set(evidence.map((item) => item.code));
  const result: Practice[] = [];
  for (const item of value) {
    if (!item || !allowed.has(item.code) || !formats.includes(item.format) || result.some((row) => row.code === item.code)) return null;
    result.push({ code: item.code, format: item.format });
  }
  return result;
}
