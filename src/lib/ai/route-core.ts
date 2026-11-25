// Маршрут ученика v2: «Что я понял» (вывод по комплекту разбора) → маршрут из участков и мини-точок → правки в диалоге.
// Без базы данных: вызов модели передаётся снаружи. Часы проверяет платформа (по точкам и по нормам CEFR), а не модель «на глаз».
import type { LlmMsg } from "./providers";
import { parseJsonLoose, type Llm } from "./check-core";

/** Типы маршрута платформы → route_type инструкции. */
export const ROUTE_TYPE: Record<string, string> = { ge: "general", lvx: "level_plus_exam", ielts: "ielts", oge: "oge", ege: "ege", toefl: "toefl", camb: "cambridge", biz: "business", talk: "speaking", move: "relocation" };

const str = (v: unknown, n = 600) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim().slice(0, n);
const list = (v: unknown, n = 12, len = 300) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, n) : []);
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

// ───────── общий запуск: основная модель, при сбое или невалидном JSON (после одного повтора) — запасная ─────────

export type JsonRun<T> = { data: T; model: string; ms: number; tokensIn: number; tokensOut: number; retries: number; fallbackFrom?: string };

export async function runJson<T>(llm: Llm, models: string[], system: string, input: unknown, clean: (raw: Record<string, unknown>) => T, o: { maxTokens?: number; temperature?: number; tag?: string; timeoutMs?: number } = {}): Promise<JsonRun<T>> {
  let last: unknown = null;
  const maxTokens = o.maxTokens ?? 8000;
  for (let i = 0; i < models.length; i++) {
    const model = models[i], t0 = Date.now();
    try {
      const msgs: LlmMsg[] = [{ role: "system", content: system }, { role: "user", content: `INPUT\n${JSON.stringify(input, null, 1)}` }];
      let r = await llm(model, msgs, { json: true, temperature: o.temperature ?? 0.3, maxTokens, timeoutMs: o.timeoutMs });
      let tokensIn = r.tokensIn, tokensOut = r.tokensOut, retries = 0;
      let j = parseJsonLoose(r.text);
      if (!j) {
        retries = 1;
        r = await llm(model, [...msgs, { role: "assistant", content: r.text.slice(0, 8000) }, { role: "user", content: "Your previous answer was not valid JSON. Return ONLY the valid JSON object in the required format." }], { json: true, temperature: 0, maxTokens, timeoutMs: o.timeoutMs });
        tokensIn += r.tokensIn; tokensOut += r.tokensOut;
        j = parseJsonLoose(r.text);
      }
      if (!j) throw new Error(`invalid JSON from model (${o.tag ?? "json"})`);
      return { data: clean(j), model, ms: Date.now() - t0, tokensIn, tokensOut, retries, ...(i > 0 ? { fallbackFrom: models[0] } : {}) };
    } catch (e) { last = e; console.error(`[ai:${o.tag ?? "json"}] ${model}:`, (e as Error)?.message ?? e); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// ───────── «Что я понял» ─────────

export const BRIEF_KEYS = ["background", "goal", "skills", "priorities", "character", "interests", "materials", "include", "other"] as const;
export type BriefKey = (typeof BRIEF_KEYS)[number];
export type Insight = {
  summary: string; strengths: string[]; blockers: string[];
  gaps: { topic: string; level: string; priority: number; why: string }[];
  skills: Record<string, string>; dynamics: string; prefill: Partial<Record<BriefKey, string>>;
};

export function cleanInsight(raw: Record<string, unknown>): Insight {
  const gaps = (Array.isArray(raw.gaps) ? raw.gaps as Record<string, unknown>[] : []).slice(0, 20).map((g, i) => ({ topic: str(g.topic, 160), level: str(g.level, 8), priority: num(g.priority) ?? i + 1, why: str(g.why, 400) })).filter((g) => g.topic);
  const pf = obj(raw.prefill);
  const summary = str(raw.summary, 2500);
  if (!summary && !gaps.length) throw new Error("insight: empty");
  return {
    summary, strengths: list(raw.strengths, 8), blockers: list(raw.blockers, 8), gaps: gaps.sort((a, b) => a.priority - b.priority),
    skills: Object.fromEntries(Object.entries(obj(raw.skills)).map(([k, v]) => [k, str(v, 400)]).filter(([, v]) => v)),
    dynamics: str(raw.dynamics, 500),
    prefill: Object.fromEntries(BRIEF_KEYS.map((k) => [k, str(pf[k], 1200)]).filter(([, v]) => v)),
  };
}

// ───────── маршрут: участки и точки ─────────

export type RoutePoint = { title: string; level: string; hours: number; why: string; focus: string; hours_why: string };
export type RouteSegment = { title: string; kind: "gaps" | "consolidate" | "level"; summary: string; points: RoutePoint[]; units: string[]; can_do_after: string[]; checkpoint: { tests: string[]; pass_rule: string } | null; hours: number; weeks: number | null };
export type RouteDraft = {
  start: { overall_level: string; skills: Record<string, string>; gaps: string[] };
  goal: { level: string; exam: string | null; explanation: string };
  weekly_hours: number | null; segments: RouteSegment[]; total_hours: number; forecast_weeks: number | null;
  deadline_check: { fits: boolean; note: string } | null; risks: string[];
  pace_options: { lessons_per_week: number; daily_minutes: number; forecast_weeks: number }[];
  teacher_summary: string; student_message: string; changes: string;
  self_study: SelfStudy | null;
};
export const SS_SKILLS = ["listening", "reading", "speaking", "writing", "vocabulary", "grammar"] as const;
export type SelfItem = { skill: (typeof SS_SKILLS)[number]; activity: string; how: string; times_per_week: number; minutes: number; search: string; why: string };
export type SelfStudy = { minutes_per_week: number; items: SelfItem[]; tips: string[] };

/** План самостоятельной работы: минуты подгоняются под бюджет платформы (±10%). */
export function cleanSelf(raw: unknown, budget: number): SelfStudy | null {
  const o = obj(raw);
  const items = (Array.isArray(o.items) ? o.items as Record<string, unknown>[] : []).slice(0, 10).map((x) => ({
    skill: (SS_SKILLS as readonly string[]).includes(String(x.skill)) ? x.skill as SelfItem["skill"] : "vocabulary",
    activity: str(x.activity, 160), how: str(x.how, 400), times_per_week: Math.max(1, Math.min(7, Math.round(num(x.times_per_week) ?? 2))),
    minutes: Math.max(5, Math.min(90, Math.round(num(x.minutes) ?? 20))), search: str(x.search, 120), why: str(x.why, 300),
  })).filter((x) => x.activity);
  if (!items.length) return null;
  const sum = items.reduce((a, x) => a + x.times_per_week * x.minutes, 0);
  if (budget > 0 && (sum > budget * 1.1 || sum < budget * 0.9)) { const k = budget / sum; for (const x of items) x.minutes = Math.max(5, Math.round((x.minutes * k) / 5) * 5); }
  return { minutes_per_week: items.reduce((a, x) => a + x.times_per_week * x.minutes, 0), items, tips: list(o.tips, 6) };
}

const clampH = (h: number | null, lo: number, hi: number, d: number) => Math.max(lo, Math.min(hi, Math.round(h ?? d)));

export function cleanRoute(raw: Record<string, unknown>, selfBudgetMin = 0): RouteDraft {
  const st = obj(raw.start), gl = obj(raw.goal);
  const segs = (Array.isArray(raw.segments) ? raw.segments as Record<string, unknown>[] : []).slice(0, 6).map((s, i) => {
    const cp = s.checkpoint && typeof s.checkpoint === "object" ? s.checkpoint as Record<string, unknown> : null;
    const points = (Array.isArray(s.points) ? s.points as Record<string, unknown>[] : []).slice(0, 30)
      .map((p) => ({ title: str(p.title, 160), level: str(p.level, 8), hours: clampH(num(p.hours), 2, 16, 6), why: str(p.why, 500), focus: str(p.focus, 500), hours_why: str(p.hours_why, 200) }))
      .filter((p) => p.title);
    return {
      title: str(s.title, 80) || `Участок ${i + 1}`, kind: s.kind === "gaps" ? "gaps" as const : s.kind === "consolidate" ? "consolidate" as const : "level" as const, summary: str(s.summary, 600), points,
      units: list(s.units, 20), can_do_after: list(s.can_do_after, 8), checkpoint: cp ? { tests: list(cp.tests, 6, 40), pass_rule: str(cp.pass_rule) } : null,
      hours: points.reduce((a, p) => a + p.hours, 0), weeks: null as number | null,
    };
  }).filter((s) => s.points.length);
  if (!segs.length) throw new Error("route: no segments");
  const dc = raw.deadline_check && typeof raw.deadline_check === "object" ? raw.deadline_check as Record<string, unknown> : null;
  return {
    start: { overall_level: str(st.overall_level, 20), skills: Object.fromEntries(Object.entries(obj(st.skills)).map(([k, v]) => [k, str(v, 20)])), gaps: list(st.gaps, 8) },
    goal: { level: str(gl.level, 40), exam: gl.exam ? str(gl.exam, 60) : null, explanation: str(gl.explanation, 800) },
    weekly_hours: num(raw.weekly_hours), segments: segs, total_hours: 0, forecast_weeks: null,
    deadline_check: dc ? { fits: !!dc.fits, note: str(dc.note, 800) } : null, risks: list(raw.risks, 8),
    pace_options: (Array.isArray(raw.pace_options) ? raw.pace_options as Record<string, unknown>[] : []).slice(0, 5).map((p) => ({ lessons_per_week: num(p.lessons_per_week) ?? 0, daily_minutes: num(p.daily_minutes) ?? 0, forecast_weeks: num(p.forecast_weeks) ?? 0 })).filter((p) => p.lessons_per_week > 0),
    teacher_summary: str(raw.teacher_summary, 1500), student_message: str(raw.student_message, 1200), changes: str(raw.changes, 1200),
    self_study: cleanSelf(raw.self_study, selfBudgetMin),
  };
}

/** Норма часов между подуровнями: «B2+ → C1» → 100 (по таблице CEFR платформы). */
export function guideHours(title: string, hoursTo: (l: string) => number) {
  const m = title.match(/([ABC][12][+]?)\s*(?:→|->|—|–|-)\s*([ABC][12][+]?)/);
  if (!m) return null;
  const d = hoursTo(m[2]) - hoursTo(m[1]);
  return d > 0 ? d : null;
}

/**
 * Часы считает платформа: участок = сумма точек. Участок нового уровня держим в пределах нормы ±25%
 * (точки масштабируются пропорционально), «закрыть пробелы» — не больше 60% нормы перехода. Затем недели.
 */
export function settleHours(d: RouteDraft, weekly: number, hoursTo: (l: string) => number): RouteDraft {
  for (const s of d.segments) {
    const guide = guideHours(s.title, hoursTo);
    let sum = s.points.reduce((a, p) => a + p.hours, 0);
    if (guide) {
      const lo = s.kind === "gaps" ? 0 : guide * 0.75, hi = s.kind === "gaps" ? guide * 0.6 : guide * 1.25;
      const target = sum < lo ? lo : sum > hi ? hi : sum;
      if (target !== sum && sum > 0) {
        const k = target / sum;
        for (const p of s.points) {
          const h = Math.max(2, Math.round(p.hours * k));
          // пояснение часов — с поправкой платформы, чтобы не расходилось с цифрой
          if (h !== p.hours) p.hours_why = `${(p.hours_why || "").replace(/\s*→\s*~?\d+\s*ч\.?\s*$/, "")} → ${h} ч (${k > 1 ? "добавлено" : "сокращено"} по норме уровня ${s.title}: ${guide} ч)`.trim();
          p.hours = h;
        }
        sum = s.points.reduce((a, p) => a + p.hours, 0);
      }
    }
    if (!guide && s.kind === "consolidate" && sum > 40) { const k = 40 / sum; for (const p of s.points) p.hours = Math.max(2, Math.round(p.hours * k)); sum = s.points.reduce((a, p) => a + p.hours, 0); }
    s.hours = sum;
    s.weeks = weekly > 0 ? Math.max(1, Math.round(sum / weekly)) : null;
  }
  d.total_hours = d.segments.reduce((a, s) => a + s.hours, 0);
  d.forecast_weeks = weekly > 0 ? Math.max(1, Math.round(d.total_hours / weekly)) : null;
  d.weekly_hours = weekly > 0 ? Math.round(weekly * 10) / 10 : d.weekly_hours;
  return d;
}

// ───────── точка маршрута на платформе ─────────

/** Подсказки ИИ к точке: что подсадить вокруг главной грамматики. Видны только учителю. */
export type Theme = { title: string; why: string; keywords: string[]; article: string; article_query: string; podcast_query: string; video_query: string };
export type ArticleRecs = { summary: string; vocabulary: string[]; phrasal_verbs: string[]; idioms: string[]; grammar_examples: string[]; grammar_note: string; reading_questions: string[]; speaking: string; writing: string };
export type Article = { id: string; title: string; url: string; excerpt: string; at: string; recs: ArticleRecs };
export type PointRecs = { themes?: Theme[]; grammar: string[]; vocabulary: string[]; phrasal_verbs: string[]; idioms: string[]; reading: string; listening: string; speaking: string; writing: string };
export const REC_LISTS = ["grammar", "vocabulary", "phrasal_verbs", "idioms"] as const;
export const REC_TEXTS = ["reading", "listening", "speaking", "writing"] as const;
/** Утверждённое учителем (или вписанное своё) — видно ученику. */
export type PointOk = { theme?: string; materials?: { title: string; url: string }[]; grammar?: string[]; vocabulary?: string[]; phrasal_verbs?: string[]; idioms?: string[]; reading?: string; listening?: string; speaking?: string; writing?: string; note?: string };
export type Point = { id: string; title: string; level: string; hours: number; why: string; focus: string; hours_why?: string; recs?: PointRecs | null; ok?: PointOk; articles?: Article[] };

export function cleanRecs(raw: Record<string, unknown>): PointRecs {
  const themes = (Array.isArray(raw.themes) ? raw.themes as Record<string, unknown>[] : []).slice(0, 6).map((x) => ({
    title: str(x.title, 100), why: str(x.why, 300), keywords: list(x.keywords, 8, 60), article: str(x.article, 300),
    article_query: str(x.article_query, 120), podcast_query: str(x.podcast_query, 120), video_query: str(x.video_query, 120),
  })).filter((x) => x.title);
  const r = {
    themes,
    grammar: list(raw.grammar, 6, 200), vocabulary: list(raw.vocabulary, 16, 80), phrasal_verbs: list(raw.phrasal_verbs, 10, 80), idioms: list(raw.idioms, 6, 120),
    reading: str(raw.reading, 500), listening: str(raw.listening, 500), speaking: str(raw.speaking, 500), writing: str(raw.writing, 500),
  };
  if (!r.vocabulary.length && !r.grammar.length && !r.reading) throw new Error("recs: empty");
  return r;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim();
const pid = (s: string, i: number) => `p${i}-${key(s).replace(/ /g, "-").slice(0, 32)}`;

export function cleanArticle(raw: Record<string, unknown>): ArticleRecs {
  const r = {
    summary: str(raw.summary, 800), vocabulary: list(raw.vocabulary, 20, 80), phrasal_verbs: list(raw.phrasal_verbs, 12, 80), idioms: list(raw.idioms, 8, 120),
    grammar_examples: list(raw.grammar_examples, 8, 300), grammar_note: str(raw.grammar_note, 300), reading_questions: list(raw.reading_questions, 8, 300),
    speaking: str(raw.speaking, 500), writing: str(raw.writing, 500),
  };
  if (!r.vocabulary.length && !r.reading_questions.length) throw new Error("article: empty");
  return r;
}

/** Участки ИИ → этапы маршрута платформы с точками. Подсказки и утверждённое из прежней версии сохраняются (по названию точки). */
export function toStages(d: RouteDraft, goalLevel: string, prev: { points?: Point[] }[] = []) {
  const old = new Map(prev.flatMap((s) => s.points ?? []).map((p) => [key(p.title), p]));
  let n = 0;
  return d.segments.map((s) => {
    const lvl = s.title.split(/→|->|—/).pop()?.trim().match(/[ABC][12][+\-−]?/)?.[0]?.replace("−", "-") ?? goalLevel;
    const points: Point[] = s.points.map((p) => { const o = old.get(key(p.title)); return { id: o?.id ?? pid(p.title, n++), ...p, recs: o?.recs ?? null, ok: o?.ok ?? {}, articles: o?.articles ?? [] }; });
    return {
      lvl, title: s.title, hours: s.hours, kind: s.kind, summary: s.summary,
      grammar: s.points.map((p) => p.title), vocabulary: [] as string[], skills: s.can_do_after, feel: [] as string[],
      focus: [] as string[], units: s.units, checkpoint: s.checkpoint, weeks: s.weeks, points,
    };
  });
}

/** Текущий маршрут — коротко для правки в диалоге (без подсказок). */
export function compactStages(stages: { title: unknown; kind?: string; points?: Point[]; checkpoint?: unknown; hours: number }[]) {
  return stages.map((s) => ({ title: typeof s.title === "string" ? s.title : Array.isArray(s.title) ? String(s.title[1]) : "", kind: s.kind ?? "level", hours: s.hours, points: (s.points ?? []).map((p) => ({ title: p.title, level: p.level, hours: p.hours, hours_why: p.hours_why, why: p.why, focus: p.focus, teacher_approved: p.ok && Object.keys(p.ok).length ? p.ok : undefined })), checkpoint: s.checkpoint }));
}
