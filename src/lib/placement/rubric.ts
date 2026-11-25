// Критерии письма и говорения в placement test. v2 — по шкалам Cambridge, баллы 0–5 относительно уровня задания
// (5 — описание уровня задания, 3 — уровня ниже, 1 — на два уровня ниже, 4 и 2 — между ними).
// v1 — прежние критерии 0–3: старые проверенные тесты показываются и считаются по ним.
import v1Json from "../../../content/placement/15_rubrics.json";
import v2Json from "../../../content/standards/rubrics.json";

export type Rubric = { id: string; name_ru: string; en?: string; levels?: Record<string, string>; bands?: Record<string, string> };
export type RubricSet = { ver: 1 | 2; max: 3 | 5; writing: Rubric[]; speaking: Rubric[]; total: string };
const V1 = v1Json as unknown as { writing: { criteria: Rubric[] }; speaking: { criteria: Rubric[] }; total_ru: string };
const V2 = v2Json as unknown as { writing: { criteria: Rubric[] }; speaking: { criteria: Rubric[] }; total_ru: string; bands_ru: Record<string, string>; length: Record<string, string> };
export const RUB_V1: RubricSet = { ver: 1, max: 3, writing: V1.writing.criteria, speaking: V1.speaking.criteria, total: V1.total_ru };
export const RUB_V2: RubricSet = { ver: 2, max: 5, writing: V2.writing.criteria, speaking: V2.speaking.criteria, total: V2.total_ru };
export const BANDS_RU = V2.bands_ru;
export const LENGTH_RU = V2.length;

const OLD_IDS = new Set(["task", "coherence", "fluency"]);
/** Какой набор критериев у этой проверки: есть оценки по прежним критериям (и нет новых) — v1. */
export function rubricOf(review: { writing?: Record<string, unknown>; speaking?: Record<string, unknown>; rubric?: number } | null | undefined): RubricSet {
  if (review?.rubric === 2) return RUB_V2;
  if (review?.rubric === 1) return RUB_V1;
  const keys = [...Object.keys(review?.writing ?? {}), ...Object.keys(review?.speaking ?? {})];
  return keys.some((k) => OLD_IDS.has(k)) ? RUB_V1 : RUB_V2;
}

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
const down = (level: string, n: number) => { const i = CEFR.indexOf(level.replace(/\+$/, "")); return i - n >= 0 ? CEFR[i - n] : null; };

/** Расшифровка балла v2 для подсказки: что значит этот балл для уровня задания. */
export function describe5(c: Rubric, level: string, v: number): string {
  if (c.bands) return c.bands[String(v)] ?? BANDS_RU[String(v)] ?? "";
  const L = level.replace(/\+$/, "");
  const at = (n: number) => { const l = down(L, n); return l ? `${l}: ${c.levels?.[l] ?? ""}` : "ниже A1: отдельные слова, смысл почти не передан"; };
  if (v === 5) return at(0);
  if (v === 3) return at(1);
  if (v === 1) return at(2);
  const part = (n: number) => { const l = down(L, n); return l ? `Частично ${l} (между ${l} и уровнем ниже): ${c.levels?.[l] ?? ""}` : "Между 3 и 1"; };
  if (v === 4) return part(0);
  if (v === 2) return part(1);
  return BANDS_RU["0"];
}

/** Ступень (индекс подуровня) по баллам v2: сумма из 20 → подуровень относительно уровня задания. */
export function step5(scores: (number | null | undefined)[], base: number, gate?: number | null) {
  const xs = scores.filter((x): x is number => typeof x === "number");
  if (xs.length < scores.length || !xs.length) return null;
  const sum = (xs.reduce((a, b) => a + b, 0) / xs.length) * 4; // к шкале из 20
  let r = sum >= 20 ? Math.min(8, base + 1) : sum >= 17 ? base : sum >= 13 ? base - 1 : sum >= 9 ? base - 2 : sum >= 5 ? base - 3 : base - 4;
  if (typeof gate === "number" && gate <= 2) r = Math.min(r, base - 2);
  return Math.max(0, r);
}
/** «Слабый» балл (для отчёта «Над чем поработать»). */
export const weakAt = (set: RubricSet) => (set.ver === 2 ? 2 : 1);

import { BASE, scoreStep, type PLevel } from "./engine";
/** Ключ критерия-«ворот» письма: не выполнено задание — итог ниже. */
export const gateKey = (set: RubricSet) => (set.ver === 2 ? "content" : "task");
/** Подуровень навыка по баллам — по версии критериев. */
export function stepBy(set: RubricSet, scores: (number | null | undefined)[], level: PLevel, gate?: number | null) {
  return set.ver === 2 ? step5(scores, BASE[level], gate) : scoreStep(scores, level, gate);
}
