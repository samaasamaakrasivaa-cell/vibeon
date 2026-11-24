// Проверка работ учеников ИИ — по docs/ai/VibeOn_AI_проверка_работ.md, раздел «Для разработчика».
// Два шага: (1) проверка, (2) самопроверка черновика. Ответ — только JSON; невалидный JSON — один повтор;
// правки, которых нет в тексте ученика, отбрасываются. Без базы данных: вызов модели передаётся снаружи (Llm).
import type { ChatRes, LlmMsg, LlmOpts } from "./providers";

export type Llm = (model: string, messages: LlmMsg[], o?: LlmOpts) => Promise<ChatRes>;

export const TASK_TYPES = ["essay", "open_answer", "speech_transcript"] as const;
export type CheckTaskType = (typeof TASK_TYPES)[number];
export const EXAMS = ["none", "ielts_writing_task1", "ielts_writing_task2", "ielts_speaking", "oge", "ege"] as const;
export type Exam = (typeof EXAMS)[number];
export const CATEGORIES = ["grammar", "vocabulary", "collocation", "spelling", "punctuation", "word_order", "register", "cohesion", "task"] as const;
export type Category = (typeof CATEGORIES)[number];
export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
/** Подуровни — как в инструкции. */
export const CHECK_LEVELS = ["A1", "A2", "A2+", "B1", "B1+", "B2−", "B2", "B2+", "C1−", "C1"] as const;

export type CheckInput = {
  task_type: CheckTaskType; level: string; exam: Exam; exam_criteria: string;
  task_prompt: string; lesson_focus: string; teacher_notes: string; student_text: string;
};

export type Edit = {
  id: number; type: "error" | "improvement"; original: string; start: number; end: number; corrected: string;
  category: Category; severity: Severity; explanation: string;
  /** кто сделал правку: ИИ или учитель (добавил сам); aiId — номер правки ИИ, из которой выросла эта (для «Качества ИИ») */
  by?: "ai" | "teacher"; aiId?: number;
};
export type Summary = { strengths: string[]; main_issues: string[]; next_steps: string[]; task_achievement: string; estimated_level: string; comment_to_student: string };
export type Scores = { exam: string; criteria: { name: string; score: string; justification: string }[]; overall: string | null; note: string } | null;
export type CheckResult = { edits: Edit[]; corrected_text: string; summary: Summary; scores: Scores };
export type CheckMeta = { model: string; ms: number; tokensIn: number; tokensOut: number; retries: number; dropped: number; selfCheck: boolean; fallbackFrom?: string; error?: string };
export type CheckRun = { result: CheckResult; meta: CheckMeta };

// ───────── Нормализация уровня ─────────

const LV = ["A1", "A2", "A2+", "B1", "B1+", "B2-", "B2", "B2+", "C1-", "C1", "C1+", "C2"];
export const levelRank = (l?: string | null) => LV.indexOf((l ?? "").trim().replace("−", "-").replace(/^([ABC][12])\s*\+$/, "$1+"));
/** Улучшения — только с B1+ (по инструкции), не больше 5. */
const improvementsAllowed = (level: string) => { const r = levelRank(level); return r < 0 || r >= LV.indexOf("B1+"); };

// ───────── Личные данные: замена с картой позиций ─────────
// Имена, почта и телефоны уходят в ИИ заменёнными; позиции правок потом переводятся обратно в исходный текст.

type Repl = { s0: number; s1: number; o0: number; o1: number; orig: string; ph: string };
export type Scrubbed = { text: string; toOrig: (pos: number, end?: boolean) => number; restore: (s: string) => string };

export function scrubWithMap(text: string, names: (string | null | undefined)[] = []): Scrubbed {
  const pats: [RegExp, string][] = [
    [/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]"],
    [/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, "[телефон]"],
    ...names.filter((n): n is string => !!n && n.length > 1).map((n) => [new RegExp(`(?<![\\p{L}\\p{N}_])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "giu"), "[имя]"] as [RegExp, string]),
  ];
  const hits: { o0: number; o1: number; ph: string }[] = [];
  for (const [re, ph] of pats) for (const m of text.matchAll(re)) {
    const o0 = m.index!, o1 = o0 + m[0].length;
    if (!hits.some((h) => o0 < h.o1 && o1 > h.o0)) hits.push({ o0, o1, ph });
  }
  hits.sort((a, b) => a.o0 - b.o0);
  const reps: Repl[] = [];
  let out = "", last = 0;
  for (const h of hits) {
    out += text.slice(last, h.o0);
    reps.push({ s0: out.length, s1: out.length + h.ph.length, o0: h.o0, o1: h.o1, orig: text.slice(h.o0, h.o1), ph: h.ph });
    out += h.ph; last = h.o1;
  }
  out += text.slice(last);
  const toOrig = (pos: number, end = false) => {
    let shift = 0;
    for (const r of reps) {
      if (pos <= r.s0) break;
      if (pos < r.s1) return end ? r.o1 : r.o0; // внутри замены — растягиваем до исходного фрагмента
      shift = r.o1 - r.s1;
    }
    return pos + shift;
  };
  // плейсхолдеры в исправлениях возвращаем по порядку появления
  const restore = (s: string) => {
    const left = new Map<string, string[]>();
    for (const r of reps) left.set(r.ph, [...(left.get(r.ph) ?? []), r.orig]);
    return s.replace(/\[(имя|email|телефон)\]/g, (m) => left.get(m)?.[0] ?? m);
  };
  return { text: out, toOrig, restore };
}

// ───────── Блок INPUT ─────────

export function inputBlock(i: CheckInput): string {
  const f = (v: string) => v.trim() || "(empty)";
  return [
    "INPUT",
    `task_type: ${i.task_type}`,
    `level: ${i.level || "(unknown)"}`,
    `exam: ${i.exam}`,
    `exam_criteria: ${f(i.exam_criteria)}`,
    `task_prompt: ${f(i.task_prompt)}`,
    `lesson_focus: ${f(i.lesson_focus)}`,
    `teacher_notes: ${f(i.teacher_notes)}`,
    "student_text (character positions start at 0 with the first character after the line <<<STUDENT_TEXT and end before the line STUDENT_TEXT>>>):",
    "<<<STUDENT_TEXT",
    i.student_text,
    "STUDENT_TEXT>>>",
  ].join("\n");
}

// ───────── Разбор и проверка JSON ─────────

/** JSON из ответа модели: без ```-обёртки и текста вокруг. null — не разобрать. */
export function parseJsonLoose(text: string): Record<string, unknown> | null {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(t.slice(a, b + 1)); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

const str = (v: unknown, n = 2000) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim().slice(0, n);
const strList = (v: unknown, n = 6) => (Array.isArray(v) ? v.map((x) => str(x, 600)).filter(Boolean).slice(0, n) : typeof v === "string" && v.trim() ? [str(v, 600)] : []);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list as readonly string[]).includes(String(v)) ? (v as T) : d;

/** Найти фрагмент в тексте: сначала по указанной позиции, иначе — ближайшее вхождение, не занятое другими правками. */
function locate(text: string, original: string, start: number, taken: [number, number][]) {
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  if (original && Number.isInteger(start) && text.slice(start, start + original.length) === original && free(start, start + original.length)) return start;
  if (!original) return -1;
  let best = -1, bestD = Infinity;
  for (let p = text.indexOf(original); p >= 0; p = text.indexOf(original, p + 1)) {
    if (!free(p, p + original.length)) continue;
    const d = Math.abs(p - (Number.isFinite(start) ? start : 0));
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Исправленный текст = текст ученика с применёнными правками (собираем сами, чтобы он точно совпадал с правками). */
export function applyEdits(text: string, edits: Pick<Edit, "start" | "end" | "corrected">[]) {
  let out = "", last = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) { out += text.slice(last, e.start) + e.corrected; last = e.end; }
  return out + text.slice(last);
}

/** Привести ответ модели к схеме: правки — только те, что дословно есть в тексте; улучшения — с B1+, не больше 5. */
export function normalize(raw: Record<string, unknown>, input: Pick<CheckInput, "student_text" | "level" | "task_type">): { result: CheckResult; dropped: number } {
  const text = input.student_text;
  const list = Array.isArray(raw.edits) ? raw.edits as Record<string, unknown>[] : [];
  const taken: [number, number][] = [];
  const edits: Edit[] = [];
  let dropped = 0, improvements = 0;
  const allowImpr = improvementsAllowed(input.level);
  for (const e of list) {
    if (!e || typeof e !== "object") { dropped++; continue; }
    const original = typeof e.original === "string" ? e.original : "";
    const corrected = typeof e.corrected === "string" ? e.corrected : "";
    const type = e.type === "improvement" ? "improvement" : "error";
    const category = oneOf(e.category, CATEGORIES, "grammar");
    // «task» — про выполнение задания: в тексте не правим (по инструкции), уходит в сводку
    if (category === "task" || !original.trim() || original === corrected) { dropped++; continue; }
    if (type === "improvement" && (!allowImpr || improvements >= 5)) { dropped++; continue; }
    // расшифровка речи: без пунктуации и заглавных
    if (input.task_type === "speech_transcript" && (category === "punctuation" || original.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "") === corrected.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ""))) { dropped++; continue; }
    const at = locate(text, original, Number(e.start), taken);
    if (at < 0) { dropped++; continue; }
    taken.push([at, at + original.length]);
    if (type === "improvement") improvements++;
    edits.push({
      id: 0, type, original, start: at, end: at + original.length, corrected: str(corrected, 1000),
      category, severity: oneOf(e.severity, SEVERITIES, "medium"), explanation: str(e.explanation, 600), by: "ai",
    });
  }
  edits.sort((a, b) => a.start - b.start).forEach((e, i) => { e.id = i + 1; e.aiId = i + 1; });
  const sm = (raw.summary ?? {}) as Record<string, unknown>;
  const summary: Summary = {
    strengths: strList(sm.strengths), main_issues: strList(sm.main_issues, 3), next_steps: strList(sm.next_steps),
    task_achievement: str(sm.task_achievement, 600), estimated_level: str(sm.estimated_level, 40), comment_to_student: str(sm.comment_to_student, 1500),
  };
  const sc = raw.scores && typeof raw.scores === "object" ? raw.scores as Record<string, unknown> : null;
  const scores: Scores = sc ? {
    exam: str(sc.exam, 40),
    criteria: (Array.isArray(sc.criteria) ? sc.criteria as Record<string, unknown>[] : []).slice(0, 8).map((c) => ({ name: str(c?.name, 120), score: str(c?.score, 20), justification: str(c?.justification, 600) })).filter((c) => c.name),
    overall: sc.overall == null ? null : str(sc.overall, 20), note: str(sc.note, 600),
  } : null;
  return { result: { edits, corrected_text: applyEdits(text, edits), summary, scores }, dropped };
}

/** Результат в формате ответа модели (для шага 2 — черновик целиком). */
const asModelJson = (r: CheckResult) => JSON.stringify({
  edits: r.edits.map(({ id, type, original, start, end, corrected, category, severity, explanation }) => ({ id, type, original, start, end, corrected, category, severity, explanation })),
  corrected_text: r.corrected_text, summary: r.summary, scores: r.scores,
});

const RETRY = "Your previous answer was not valid JSON. Return ONLY the valid JSON object in the required format, with no text before or after it.";

// ───────── Конвейер ─────────

export type Prompts = { check: string; review: string };

/** Один шаг: ответ модели → JSON; невалидный — один повтор с просьбой вернуть валидный JSON. */
async function step(llm: Llm, model: string, system: string, user: string, meta: CheckMeta, temperature: number) {
  const msgs: LlmMsg[] = [{ role: "system", content: system }, { role: "user", content: user }];
  const r1 = await llm(model, msgs, { json: true, temperature, maxTokens: 6000 });
  meta.tokensIn += r1.tokensIn; meta.tokensOut += r1.tokensOut;
  const j1 = parseJsonLoose(r1.text);
  if (j1) return j1;
  meta.retries++;
  const r2 = await llm(model, [...msgs, { role: "assistant", content: r1.text.slice(0, 6000) }, { role: "user", content: RETRY }], { json: true, temperature: 0, maxTokens: 6000 });
  meta.tokensIn += r2.tokensIn; meta.tokensOut += r2.tokensOut;
  return parseJsonLoose(r2.text);
}

/** Проверка одной моделью: шаг 1 → шаг 2 (самопроверка). Шаг 2 не дал JSON — остаётся проверенный черновик шага 1. */
export async function checkWith(llm: Llm, model: string, input: CheckInput, p: Prompts): Promise<CheckRun> {
  const t0 = Date.now();
  const meta: CheckMeta = { model, ms: 0, tokensIn: 0, tokensOut: 0, retries: 0, dropped: 0, selfCheck: false };
  const block = inputBlock(input);
  const raw1 = await step(llm, model, p.check, block, meta, 0.2);
  if (!raw1) throw new Error("invalid JSON from model (step 1)");
  const d1 = normalize(raw1, input);
  let out = d1;
  const raw2 = await step(llm, model, p.review, `${block}\n\nDRAFT JSON:\n${asModelJson(d1.result)}`, meta, 0.1);
  if (raw2) {
    const d2 = normalize(raw2, input);
    // самопроверка вернула пустоту при непустом черновике — скорее сбой, чем «ошибок нет»
    if (!(d2.result.edits.length === 0 && d1.result.edits.length > 2 && !d2.result.summary.comment_to_student)) { out = d2; meta.selfCheck = true; }
  }
  meta.dropped = d1.dropped + (out === d1 ? 0 : out.dropped);
  meta.ms = Date.now() - t0;
  return { result: out.result, meta };
}

/** Основная модель, при сбое — запасная. */
export async function runCheck(llm: Llm, models: string[], input: CheckInput, p: Prompts): Promise<CheckRun> {
  let lastErr: unknown = null;
  for (let i = 0; i < models.length; i++) {
    try {
      const r = await checkWith(llm, models[i], input, p);
      if (i > 0) { r.meta.fallbackFrom = models[0]; r.meta.error = String((lastErr as Error)?.message ?? lastErr).slice(0, 300); }
      return r;
    } catch (e) { lastErr = e; console.error(`[ai:check] ${models[i]}:`, (e as Error)?.message ?? e); }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Перевести правки из текста с заменёнными личными данными в исходный текст ученика. */
export function unscrub(r: CheckResult, sc: Scrubbed, original: string): CheckResult {
  const edits = r.edits.map((e) => {
    const start = sc.toOrig(e.start), end = sc.toOrig(e.end, true);
    return { ...e, start, end, original: original.slice(start, end), corrected: sc.restore(e.corrected), explanation: sc.restore(e.explanation) };
  });
  const fix = (s: string) => sc.restore(s);
  return {
    edits, corrected_text: applyEdits(original, edits),
    summary: { ...r.summary, strengths: r.summary.strengths.map(fix), main_issues: r.summary.main_issues.map(fix), next_steps: r.summary.next_steps.map(fix), comment_to_student: fix(r.summary.comment_to_student), task_achievement: fix(r.summary.task_achievement) },
    scores: r.scores,
  };
}

// ───────── «Качество ИИ»: что учитель сделал с правками ИИ ─────────

export type Stats = { ai: number; kept: number; edited: number; removed: number; added: number };

export function compareEdits(draft: CheckResult, final: CheckResult): Stats {
  const byAi = new Map(final.edits.filter((e) => e.aiId).map((e) => [e.aiId!, e]));
  let kept = 0, edited = 0, removed = 0;
  for (const d of draft.edits) {
    const f = byAi.get(d.aiId ?? d.id);
    if (!f) removed++;
    else if (f.corrected === d.corrected && f.type === d.type && f.category === d.category && f.explanation === d.explanation && f.start === d.start && f.end === d.end) kept++;
    else edited++;
  }
  return { ai: draft.edits.length, kept, edited, removed, added: final.edits.filter((e) => e.by === "teacher" || !e.aiId).length };
}

/** Итог от учителя (из браузера): проверить и привести к схеме — правки только по тексту ученика. */
export function cleanFinal(raw: unknown, text: string): CheckResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.edits) ? r.edits as Record<string, unknown>[] : [];
  const taken: [number, number][] = [];
  const edits: Edit[] = [];
  for (const e of list.slice(0, 200)) {
    const start = Number(e?.start), end = Number(e?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) continue;
    if (taken.some(([a, b]) => start < b && end > a)) continue;
    taken.push([start, end]);
    const aiId = Number(e.aiId);
    edits.push({
      id: edits.length + 1, type: e.type === "improvement" ? "improvement" : "error", original: text.slice(start, end), start, end,
      corrected: str(e.corrected, 1000), category: oneOf(e.category, CATEGORIES, "grammar"), severity: oneOf(e.severity, SEVERITIES, "medium"),
      explanation: str(e.explanation, 600), by: e.by === "teacher" ? "teacher" : "ai", ...(Number.isInteger(aiId) && aiId > 0 && e.by !== "teacher" ? { aiId } : {}),
    });
  }
  edits.sort((a, b) => a.start - b.start);
  const sm = (r.summary ?? {}) as Record<string, unknown>;
  const sc = r.scores && typeof r.scores === "object" ? r.scores as Record<string, unknown> : null;
  return {
    edits, corrected_text: applyEdits(text, edits),
    summary: { strengths: strList(sm.strengths, 8), main_issues: strList(sm.main_issues, 6), next_steps: strList(sm.next_steps, 8), task_achievement: str(sm.task_achievement, 600), estimated_level: str(sm.estimated_level, 40), comment_to_student: str(sm.comment_to_student, 2000) },
    scores: sc ? { exam: str(sc.exam, 40), criteria: (Array.isArray(sc.criteria) ? sc.criteria as Record<string, unknown>[] : []).slice(0, 8).map((c) => ({ name: str(c?.name, 120), score: str(c?.score, 20), justification: str(c?.justification, 600) })), overall: sc.overall == null ? null : str(sc.overall, 20), note: str(sc.note, 600) } : null,
  };
}
