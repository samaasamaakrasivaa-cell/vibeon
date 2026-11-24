// Черновик маршрута ученика — по docs/ai/VibeOn_AI_маршрут_ученика.md. Один вызов, температура 0.3, строгий JSON.
// Без базы данных: вызов модели передаётся снаружи. Ответ раскладывается в этапы маршрута платформы.
import type { LlmMsg } from "./providers";
import { parseJsonLoose, type Llm } from "./check-core";

export type RouteInput = {
  student: { age: number | null; form: Record<string, string> };
  route_type: string; goal: string; deadline: string | null;
  /** сколько недель до срока — считает платформа (модели ошибаются в арифметике дат) */
  weeks_until_deadline: number | null;
  placement: { overall_level: string | null; skills: Record<string, number | string>; weak: string[]; date: string | null } | null;
  checkpoints: { kind: string; stage: number | null; level: string | null; score: number | null; date: string | null }[];
  pace: { lessons_per_week: number; lesson_minutes: number; daily_minutes: number };
  courses: { leading: string | null; others: string[]; units: { title: string; outcomes: string[] }[] };
  teacher_notes: string; today: string;
};

export type RouteStage = {
  id: number; title: string; study_hours: number; forecast_weeks: number | null; focus: string[]; units: string[];
  can_do_after: string[]; checkpoint: { tests: string[]; pass_rule: string } | null;
};
export type RouteDraft = {
  start: { overall_level: string; skills: Record<string, string>; gaps: string[] };
  goal: { level: string; exam: string | null; explanation: string };
  weekly_hours: number | null; stages: RouteStage[]; total_hours: number | null; forecast_weeks: number | null;
  deadline_check: { fits: boolean; note: string } | null; risks: string[];
  pace_options: { lessons_per_week: number; daily_minutes: number; forecast_weeks: number }[];
  teacher_summary: string; student_message: string;
};

/** Типы маршрута платформы → route_type инструкции. */
export const ROUTE_TYPE: Record<string, string> = { ge: "general", lvx: "level_plus_exam", ielts: "ielts", oge: "oge", ege: "ege", toefl: "toefl", camb: "cambridge", biz: "business", talk: "speaking", move: "relocation" };

const str = (v: unknown, n = 600) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim().slice(0, n);
const list = (v: unknown, n = 12) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, n) : []);
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

/** Проверить ответ модели по схеме; без этапов — ошибка. */
export function cleanRoute(raw: Record<string, unknown>): RouteDraft {
  const st = (raw.start ?? {}) as Record<string, unknown>;
  const gl = (raw.goal ?? {}) as Record<string, unknown>;
  const stages = (Array.isArray(raw.stages) ? raw.stages as Record<string, unknown>[] : []).slice(0, 12).map((s, i) => {
    const cp = s.checkpoint && typeof s.checkpoint === "object" ? s.checkpoint as Record<string, unknown> : null;
    return {
      id: i + 1, title: str(s.title, 120) || `Stage ${i + 1}`, study_hours: Math.max(5, Math.min(400, Math.round(num(s.study_hours) ?? 60))),
      forecast_weeks: num(s.forecast_weeks), focus: list(s.focus), units: list(s.units, 20), can_do_after: list(s.can_do_after),
      checkpoint: cp ? { tests: list(cp.tests, 6), pass_rule: str(cp.pass_rule) } : null,
    };
  });
  if (!stages.length) throw new Error("route: no stages");
  const dc = raw.deadline_check && typeof raw.deadline_check === "object" ? raw.deadline_check as Record<string, unknown> : null;
  return {
    start: { overall_level: str(st.overall_level, 20), skills: Object.fromEntries(Object.entries((st.skills ?? {}) as Record<string, unknown>).map(([k, v]) => [k, str(v, 20)])), gaps: list(st.gaps, 8) },
    goal: { level: str(gl.level, 40), exam: gl.exam ? str(gl.exam, 60) : null, explanation: str(gl.explanation, 800) },
    weekly_hours: num(raw.weekly_hours), stages, total_hours: num(raw.total_hours), forecast_weeks: num(raw.forecast_weeks),
    deadline_check: dc ? { fits: !!dc.fits, note: str(dc.note, 800) } : null, risks: list(raw.risks, 8),
    pace_options: (Array.isArray(raw.pace_options) ? raw.pace_options as Record<string, unknown>[] : []).slice(0, 5).map((p) => ({ lessons_per_week: num(p.lessons_per_week) ?? 0, daily_minutes: num(p.daily_minutes) ?? 0, forecast_weeks: num(p.forecast_weeks) ?? 0 })).filter((p) => p.lessons_per_week > 0),
    teacher_summary: str(raw.teacher_summary, 1500), student_message: str(raw.student_message, 1200),
  };
}

export type RouteRun = { draft: RouteDraft; model: string; ms: number; tokensIn: number; tokensOut: number; retries: number; fallbackFrom?: string };

/** Основная модель, при сбое или невалидном JSON (после одного повтора) — запасная. */
export async function runRoute(llm: Llm, models: string[], input: RouteInput, system: string): Promise<RouteRun> {
  let last: unknown = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i], t0 = Date.now();
    try {
      const msgs: LlmMsg[] = [{ role: "system", content: system }, { role: "user", content: `INPUT\n${JSON.stringify(input, null, 1)}` }];
      let r = await llm(model, msgs, { json: true, temperature: 0.3, maxTokens: 6000 });
      let tokensIn = r.tokensIn, tokensOut = r.tokensOut, retries = 0;
      let j = parseJsonLoose(r.text);
      if (!j) {
        retries = 1;
        r = await llm(model, [...msgs, { role: "assistant", content: r.text.slice(0, 6000) }, { role: "user", content: "Your previous answer was not valid JSON. Return ONLY the valid JSON object in the required format." }], { json: true, temperature: 0, maxTokens: 6000 });
        tokensIn += r.tokensIn; tokensOut += r.tokensOut;
        j = parseJsonLoose(r.text);
      }
      if (!j) throw new Error("invalid JSON from model (route)");
      return { draft: cleanRoute(j), model, ms: Date.now() - t0, tokensIn, tokensOut, retries, ...(i > 0 ? { fallbackFrom: models[0] } : {}) };
    } catch (e) { last = e; console.error(`[ai:route] ${model}:`, (e as Error)?.message ?? e); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Этап ИИ → этап маршрута платформы: уровень, часы, грамматика / лексика / навыки, что сможет, срез. */
export function toStages(d: RouteDraft, goalLevel: string) {
  const strip = (s: string) => s.replace(/^[^:]{2,30}:\s*/, "");
  return d.stages.map((s) => {
    const lvl = s.title.split(/→|->|—/).pop()?.trim().match(/[ABC][12][+\-−]?/)?.[0]?.replace("−", "-") ?? goalLevel;
    return {
      lvl, title: s.title, hours: s.study_hours,
      grammar: s.focus.filter((f) => /^(grammar|грамматик)/i.test(f)).map(strip),
      vocabulary: s.focus.filter((f) => /^(vocab|лексик|words|слова)/i.test(f)).map(strip),
      skills: s.can_do_after,
      feel: [] as string[],
      focus: s.focus.filter((f) => !/^(grammar|грамматик|vocab|лексик|words|слова)/i.test(f)),
      units: s.units, checkpoint: s.checkpoint, weeks: s.forecast_weeks,
    };
  });
}
